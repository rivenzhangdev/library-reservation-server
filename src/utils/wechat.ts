import axios from 'axios';

const WX_APP_ID = process.env.WX_APP_ID || '';
const WX_APP_SECRET = process.env.WX_APP_SECRET || '';

let cachedAccessToken = {
    token: '',
    expiresAt: 0,
};

export async function getWechatAccessToken(): Promise<string> {
    if (!WX_APP_ID || !WX_APP_SECRET) {
        throw new Error('WX_APP_ID or WX_APP_SECRET is not configured');
    }

    const now = Date.now();
    if (cachedAccessToken.token && cachedAccessToken.expiresAt > now + 5000) {
        return cachedAccessToken.token;
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APP_ID}&secret=${WX_APP_SECRET}`;
    const response = await axios.get(url);
    const data = response.data as any;

    if (data.errcode) {
        throw new Error(
            `Failed to fetch WeChat access token: ${
                data.errmsg || data.errcode
            }`
        );
    }

    if (!data.access_token || !data.expires_in) {
        throw new Error('Invalid WeChat access token response');
    }

    cachedAccessToken = {
        token: data.access_token,
        expiresAt: now + (Number(data.expires_in) - 60) * 1000,
    };

    return cachedAccessToken.token;
}

export async function sendWechatSubscribeMessage(
    toUser: string,
    templateId: string,
    page?: string,
    data?: Record<string, any>,
    lang = 'zh_CN',
    miniprogramState = 'formal'
) {
    const accessToken = await getWechatAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`;
    const payload: Record<string, any> = {
        touser: toUser,
        template_id: templateId,
        data: data || {},
        lang,
        miniprogram_state: miniprogramState,
    };

    if (page) {
        payload.page = page;
    }

    const response = await axios.post(url, payload);
    const result = response.data as any;

    if (result.errcode && result.errcode !== 0) {
        throw new Error(
            `WeChat subscribe message send failed: ${
                result.errmsg || result.errcode
            }`
        );
    }

    return result;
}
