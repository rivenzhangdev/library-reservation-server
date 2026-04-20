import axios from 'axios';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Router from 'koa-router';
import { authMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { User, PhoneChangeRequest } from '../models/mongodb';
import { ErrorCodes } from '../utils/error-codes';
import { Roles } from '../constants/roles';
import { normalizeUploadUrl } from '../utils/upload';

dotenv.config();

const router = new Router({ prefix: '/api/auth' });

const JWT_SECRET = process.env.JWT_SECRET ?? 'default_secret';
const WX_APP_ID = process.env.WX_APP_ID;
const WX_APP_SECRET = process.env.WX_APP_SECRET;

async function makeWeChatUsername(base: string) {
    const prefix = '微信用户';
    const suffix = String(base)
        .slice(-6)
        .replace(/[^a-zA-Z0-9]/g, '');
    let username = `${prefix}${suffix || String(Date.now()).slice(-6)}`;
    let exists = await User.findOne({ username });
    let attempt = 0;
    while (exists && attempt < 10) {
        const randomSuffix = Math.floor(Math.random() * 9000 + 1000);
        username = `${prefix}${suffix || '用户'}${randomSuffix}`;
        exists = await User.findOne({ username });
        attempt += 1;
    }
    if (exists) {
        username = `${prefix}${Date.now()}`;
    }
    return username;
}

/**
 * @swagger
 * /api/auth/wxlogin:
 *   post:
 *     tags:
 *       - 认证授权 (Auth)
 *     summary: 微信小程序登录
 *     description: |
 *       **微信小程序登录流程：**
 *       1. 小程序端调用 wx.login() 获取 code
 *       2. 将 code 发送到本接口
 *       3. 后端调用微信 API 验证 code，获取 openid
 *       4. 使用 openid 查找或创建用户
 *       5. 生成 JWT Token 返回给小程序
 *
 *       **注意：** code 有效期 5 分钟，且只能使用一次！
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *                 example: "071abc123def456"
 *                 description: "微信登录临时凭证（由 wx.login() 获取）"
 *               userInfo:
 *                 type: object
 *                 description: "小程序端用户填写的个人信息（可选）"
 *                 properties:
 *                   avatarUrl:
 *                     type: string
 *                     format: uri
 *                     example: "https://wx.qlogo.cn/mmopen/vi_32/..."
 *                   nickName:
 *                     type: string
 *                     example: "张三"
 *     responses:
 *       200:
 *         description: 登录成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUwN2YxZjc3YmNmODZjZDc5OTQzOTAxMSIsIm9wZW5pZCI6Im9YMzRfMVRf..."
 *                       description: "JWT Token，后续请求需携带此 Token"
 *                     userInfo:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                           example: "507f1f77bcf86cd799439011"
 *                         nickName:
 *                           type: string
 *                           example: "张三"
 *                         avatarUrl:
 *                           type: string
 *                           example: "https://wx.qlogo.cn/mmopen/vi_32/..."
 *                         studentId:
 *                           type: string
 *                           nullable: true
 *                           example: null
 *                         creditScore:
 *                           type: integer
 *                           example: 100
 *                         isBindStudentId:
 *                           type: boolean
 *                           example: false
 *                         role:
 *                           type: integer
 *                           enum: [0, 1]
 *                           example: 0
 *       400:
 *         description: 请求参数错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               缺少 code:
 *                 value:
 *                   success: false
 *                   error:
 *                     code: "INVALID_CODE"
 *                     message: "缺少微信登录 code"
 *               微信 API 错误:
 *                 value:
 *                   success: false
 *                   error:
 *                     code: "WX_API_ERROR"
 *                     message: "微信登录失败：invalid code"
 *       500:
 *         description: 服务器内部错误
 */
router.post('/wxlogin', async (ctx) => {
    try {
        const { code, userInfo } = ctx.request.body as any;

        // Validate required parameters
        if (!code) {
            throw new CustomError(
                'Missing WeChat login code',
                ErrorCodes.INVALID_CODE
            );
        }

        // Check WeChat configuration to decide whether to use real API or mock mode
        let session;
        if (!WX_APP_ID || !WX_APP_SECRET) {
            console.warn(
                '⚠️  Warning: WeChat AppID or Secret not configured, using mock mode'
            );
            session = {
                openid: `mock_openid_${code}`,
                sessionKey: `mock_session_key_${code}`,
                unionid: undefined,
            };
        } else {
            // Call real WeChat API
            session = await getWechatSession(code);
        }

        // Find or create user using openid or legacy username=openid
        let user = await User.findOne({
            $or: [{ openid: session.openid }, { username: session.openid }],
        });

        const generatedUsername = await makeWeChatUsername(session.openid);

        if (!user) {
            user = new User({
                username: generatedUsername,
                openid: session.openid,
                password: await bcrypt.hash(session.openid, 10),
                avatar: userInfo?.avatarUrl,
                name: userInfo?.nickName || '',
                role: Roles.USER,
                creditScore: 100,
                studentId: null,
                isOpenidVerified: true,
            });

            await user.save();
            console.log(`✅ New user registered: ${generatedUsername}`);
        } else {
            let needUpdate = false;
            if (!user.openid) {
                user.openid = session.openid;
                needUpdate = true;
            }
            if (user.username === session.openid) {
                user.username = generatedUsername;
                needUpdate = true;
            }
            if (userInfo?.avatarUrl && user.avatar !== userInfo.avatarUrl) {
                user.avatar = userInfo.avatarUrl;
                needUpdate = true;
            }
            if (userInfo?.nickName && user.name !== userInfo.nickName) {
                user.name = userInfo.nickName;
                needUpdate = true;
            }
            if (needUpdate) {
                await user.save();
            }
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user._id,
                username: user.username,
                openid: user.username,
                role: user.role,
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Set HttpOnly cookie for browser-based clients (admin UI)
        try {
            const COOKIE_SAME_SITE = (
                process.env.COOKIE_SAME_SITE ?? 'lax'
            ).toLowerCase();
            const COOKIE_SECURE =
                process.env.COOKIE_SECURE !== undefined
                    ? process.env.COOKIE_SECURE === 'true'
                    : process.env.NODE_ENV === 'production';
            const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ?? undefined;

            if (COOKIE_SAME_SITE === 'none' && !COOKIE_SECURE) {
                console.warn(
                    'Warning: COOKIE_SAME_SITE=None while COOKIE_SECURE is not true. Browsers will reject SameSite=None cookies unless Secure is set.'
                );
            }

            ctx.cookies.set('token', token, {
                httpOnly: true,
                secure: COOKIE_SECURE,
                sameSite: COOKIE_SAME_SITE as any,
                maxAge: 7 * 24 * 3600 * 1000, // 7 days
                path: '/',
                domain: COOKIE_DOMAIN,
            });
        } catch {
            // ignore cookie set failures in non-browser environments
        }

        // Return user information
        const avatarUrl = user.avatar
            ? normalizeUploadUrl(String(user.avatar), ctx.origin)
            : undefined;

        ctx.body = {
            success: true,
            data: {
                token,
                userInfo: {
                    id: user._id,
                    username: user.username,
                    nickName: user.name,
                    avatarUrl,
                    studentId: user.studentId,
                    creditScore: user.creditScore,
                    isBindStudentId: !!user.studentId,
                    role: user.role,
                    blacklisted: !!user.blacklisted,
                    blacklistReason: user.blacklistReason ?? undefined,
                },
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('WeChat API error:', error);
        const errmsg = error.message ?? 'Unknown error';
        throw new CustomError(
            `WeChat API error: ${errmsg}`,
            ErrorCodes.WX_API_ERROR
        );
    }
});

/**
 * @route POST /api/auth/bindStudentId
 * @desc Bind student ID interface
 */
router.post('/bindStudentId', authMiddleware, async (ctx) => {
    try {
        const { studentId, realName } = ctx.request.body as any;
        const userId = (ctx as any).state.user.id;

        if (!studentId || !realName) {
            throw new CustomError(
                'Student ID and real name are required',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const currentUser = await User.findById(userId);
        if (!currentUser) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        if (currentUser.studentId) {
            throw new CustomError(
                'Student ID already bound. Submit a change request if needed.',
                ErrorCodes.STUDENT_ID_ALREADY_BOUND
            );
        }

        // Check if student ID has been bound
        const existingUser = await User.findOne({ studentId });
        if (existingUser && existingUser._id.toString() !== userId.toString()) {
            throw new CustomError(
                'This student ID has been bound by another user',
                ErrorCodes.STUDENT_ID_EXISTS
            );
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { studentId, name: realName },
            { new: true }
        );

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        ctx.body = {
            success: true,
            data: {
                studentId: user.studentId,
                realName: user.name,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to bind student ID',
            ErrorCodes.BIND_STUDENT_ID_ERROR
        );
    }
});

router.post('/phone-change-requests', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;
        const { newPhone, reason } = ctx.request.body as any;

        const normalizedPhone = String(newPhone ?? '').trim();
        if (!/^1\d{10}$/.test(normalizedPhone)) {
            throw new CustomError(
                'Please provide a valid 11-digit phone number',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const user = await User.findById(userId);
        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        if (!user.phone) {
            throw new CustomError(
                'Please bind a phone number first before requesting a change',
                ErrorCodes.INVALID_PARAMS
            );
        }

        if (user.phone === normalizedPhone) {
            throw new CustomError(
                'New phone must differ from the current phone',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const existingRequest = await PhoneChangeRequest.findOne({
            userId,
            status: 'pending',
        });
        if (existingRequest) {
            throw new CustomError(
                'There is already a pending phone change request',
                ErrorCodes.PHONE_CHANGE_REQUEST_EXISTS
            );
        }

        const existingUserWithPhone = await User.findOne({
            phone: normalizedPhone,
            _id: { $ne: userId },
        });
        if (existingUserWithPhone) {
            throw new CustomError(
                'This phone number is already in use',
                ErrorCodes.PHONE_ALREADY_EXISTS
            );
        }

        const request = new PhoneChangeRequest({
            userId,
            oldPhone: user.phone,
            newPhone: normalizedPhone,
            reason: String(reason ?? '').trim(),
            status: 'pending',
        });

        await request.save();

        ctx.body = {
            success: true,
            data: {
                id: request._id,
                status: request.status,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Create phone change request failed', error);
        throw new CustomError(
            'Failed to submit phone change request',
            ErrorCodes.PHONE_CHANGE_REQUEST_ERROR
        );
    }
});

/**
 * @route GET /api/auth/check
 * @desc Check login status interface
 */
router.get('/check', authMiddleware, async (ctx) => {
    try {
        const userId = (ctx as any).state.user.id;

        const user = await User.findById(userId).select('-password');

        if (!user) {
            throw new CustomError('User not found', ErrorCodes.USER_NOT_FOUND);
        }

        const normalizedAvatar = user.avatar
            ? normalizeUploadUrl(String(user.avatar), ctx.origin)
            : undefined;

        ctx.body = {
            success: true,
            data: {
                ...user.toObject(),
                avatar: normalizedAvatar,
                avatarUrl: normalizedAvatar,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        throw new CustomError(
            'Failed to check login status',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * Call WeChat API to get session
 * @param code WeChat login temporary credential
 * @returns Object containing openid and session_key
 */
async function getWechatSession(code: string) {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APP_ID}&secret=${WX_APP_SECRET}&js_code=${code}&grant_type=authorization_code`;
    const response = await axios.get(url);
    const { openid, session_key, unionid, errcode, errmsg } = response.data;
    if (errcode) {
        throw new CustomError(
            `WeChat API error: ${errmsg}`,
            ErrorCodes.WX_API_ERROR
        );
    }
    return { openid, session_key, unionid };
}

export default router;
