import dotenv from 'dotenv';

dotenv.config();

import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { exec } from 'child_process';
import net from 'net';
import inquirer from 'inquirer';

// 导入中间件
import { corsMiddleware } from './middleware/cors';
import { queryCleaner } from './middleware/queryCleaner';
import { errorHandler } from './middleware/error';
import { auditNameNormalizer } from './middleware/audit-name-normalizer';

// 导入路由
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import seatRoutes from './routes/seats';
import bookingRoutes, { markAllExpiredBookings } from './routes/booking';
import notificationRoutes from './routes/notification';
import activityRoutes from './routes/activity';
import feedbackRoutes from './routes/feedback';
import configRoutes from './routes/config';
import compatRoutes from './routes/compat';
import uploadsRoutes from './routes/uploads';
import uploadsAdminRoutes from './routes/uploads-admin';
import studentIdChangeRequestsRoutes from './routes/studentIdChangeRequests';
import phoneChangeRequestsRoutes from './routes/phoneChangeRequests';
import bookingRulesRoutes from './routes/booking-rules';
import bookingChangeRequestsRoutes from './routes/booking-change-requests';
import auditLogRoutes from './routes/audit-logs';
import dashboardRoutes from './routes/dashboard';
import { markAllExpiredActivities } from './services/activity-service';

// 导入数据库连接
import { testConnection, syncDatabase } from './database/mysql';
import { connectMongoDB } from './database/mongodb';
import Router from 'koa-router';

// 导入模型关系配置
import { setupMySQLModelRelations } from './models/mysql/relations';

dotenv.config();

// 小工具：端口检测 / 查找 PID / 杀进程（为启动冲突处理服务）
function checkPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const tester = net
            .createServer()
            .once('error', (err: any) => {
                if (
                    err &&
                    (err.code === 'EADDRINUSE' || err.code === 'EACCES')
                ) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            })
            .once('listening', () => {
                tester.close();
                resolve(false);
            })
            // 监听所有地址，避免 IPv6/IPv4 差异
            .listen(port, '0.0.0.0');
    });
}

function getPidsByPort(port: number): Promise<number[]> {
    return new Promise((resolve) => {
        const platform = process.platform;
        if (platform === 'win32') {
            exec(
                `netstat -ano | findstr :${port}`,
                { shell: 'cmd.exe' },
                (err: any, stdout: string) => {
                    if (err || !stdout) return resolve([]);
                    const lines = stdout.split(/\r?\n/).filter(Boolean);
                    const pids = new Set<number>();
                    lines.forEach((line) => {
                        const parts = line.trim().split(/\s+/);
                        const last = parts[parts.length - 1];
                        const pid = parseInt(last, 10);
                        if (!Number.isNaN(pid)) pids.add(pid);
                    });
                    resolve(Array.from(pids));
                }
            );
        } else {
            // 优先使用 lsof -t，若不可用返回空
            exec(
                `lsof -i :${port} -t`,
                { shell: 'sh' },
                (err: any, stdout: string) => {
                    if (err || !stdout) return resolve([]);
                    const lines = stdout.split(/\r?\n/).filter(Boolean);
                    const pids = lines
                        .map((l) => parseInt(l, 10))
                        .filter((n) => !Number.isNaN(n));
                    resolve(Array.from(new Set(pids)));
                }
            );
        }
    });
}

function killPids(pids: number[]): Promise<boolean> {
    return new Promise((resolve) => {
        if (!pids || pids.length === 0) return resolve(false);
        const platform = process.platform;
        if (platform === 'win32') {
            const args = pids.map((pid) => `/PID ${pid}`).join(' ');
            const cmd = `taskkill /F ${args}`;
            exec(cmd, { shell: 'cmd.exe' }, (err: any) => {
                resolve(!err);
            });
        } else {
            const cmd = `kill -9 ${pids.join(' ')}`;
            exec(cmd, { shell: 'sh' }, (err: any) => {
                resolve(!err);
            });
        }
    });
}

const app = new Koa();
const PORT = Number(process.env.PORT) || 3000;
// Swagger 服务使用独立端口，默认在独立脚本中计算并启动（若有需要请见 scripts/serve-swagger.js）

// 使用中间件
app.use(errorHandler);
app.use(corsMiddleware);
// 增加 bodyParser 的大小限制以支持 base64 图片上传（默认通常较小）
app.use(
    bodyParser({
        enableTypes: ['json', 'form', 'text'],
        strict: false,
        jsonLimit: '10mb',
        formLimit: '10mb',
        textLimit: '10mb',
    })
);
console.log(
    'koa-bodyparser configured: strict=false, jsonLimit=10mb, formLimit=10mb, textLimit=10mb'
);

// 清理空查询参数，避免接口接收到空字符串导致查询条件异常
app.use(queryCleaner);

// 统一补齐 createdByName/updatedByName/reviewerName/publisherName，避免各路由重复处理
app.use(auditNameNormalizer);

// 注册路由
app.use(authRoutes.routes()).use(authRoutes.allowedMethods());

app.use(userRoutes.routes()).use(userRoutes.allowedMethods());

app.use(seatRoutes.routes()).use(seatRoutes.allowedMethods());

app.use(bookingRoutes.routes()).use(bookingRoutes.allowedMethods());

app.use(configRoutes.routes()).use(configRoutes.allowedMethods());

app.use(notificationRoutes.routes()).use(notificationRoutes.allowedMethods());

app.use(activityRoutes.routes()).use(activityRoutes.allowedMethods());

app.use(feedbackRoutes.routes()).use(feedbackRoutes.allowedMethods());

// 静态上传文件服务 (simple)
app.use(uploadsRoutes.routes()).use(uploadsRoutes.allowedMethods());

// admin uploads management (includes public POST /api/uploads for compatibility)
app.use(uploadsAdminRoutes.routes()).use(uploadsAdminRoutes.allowedMethods());

app.use(studentIdChangeRequestsRoutes.routes()).use(
    studentIdChangeRequestsRoutes.allowedMethods()
);
app.use(phoneChangeRequestsRoutes.routes()).use(
    phoneChangeRequestsRoutes.allowedMethods()
);

// 企业增强功能路由
app.use(bookingRulesRoutes.routes()).use(bookingRulesRoutes.allowedMethods());
app.use(bookingChangeRequestsRoutes.routes()).use(
    bookingChangeRequestsRoutes.allowedMethods()
);
app.use(auditLogRoutes.routes()).use(auditLogRoutes.allowedMethods());
app.use(dashboardRoutes.routes()).use(dashboardRoutes.allowedMethods());

// 兼容管理端调用的路由（/api/bookings, /api/seat, /api/floors 等）
app.use(compatRoutes.routes()).use(compatRoutes.allowedMethods());

// 简单健康检查
const healthRouter = new Router();
healthRouter.get('/health', async (ctx) => {
    ctx.body = { status: 'ok' };
});
app.use(healthRouter.routes()).use(healthRouter.allowedMethods());

// 启动服务器
async function startServer() {
    try {
        // 连接数据库
        console.log('正在连接数据库...');
        await Promise.all([testConnection(), connectMongoDB()]);

        // 同步数据库表结构
        await syncDatabase(false);

        // 配置模型关系
        setupMySQLModelRelations();

        // 立即执行一次过期预约和活动扫描，补齐被动触发缺口
        await markAllExpiredBookings();
        await markAllExpiredActivities();
        const violationScanIntervalMinutes = Number(
            process.env.VIOLATION_SCAN_INTERVAL_MINUTES || 15
        );
        if (violationScanIntervalMinutes > 0) {
            setInterval(
                async () => {
                    try {
                        await markAllExpiredBookings();
                        await markAllExpiredActivities();
                    } catch (error) {
                        console.error(
                            'Failed to scan expired bookings or activities:',
                            error
                        );
                    }
                },
                violationScanIntervalMinutes * 60 * 1000
            );
        }

        // 在真正监听之前检查端口占用并提供交互式处理（若为 TTY）
        const desiredPort = PORT;
        const portInUse = await checkPortInUse(desiredPort);
        if (portInUse) {
            console.error(`端口 ${desiredPort} 已被占用。`);
            // 尝试获取占用 PID
            const pids = await getPidsByPort(desiredPort);
            if (pids && pids.length > 0)
                console.error(`占用 PID: ${pids.join(', ')}`);

            if (process.stdin && process.stdin.isTTY) {
                // 交互式提示
                const answer = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'action',
                        message: `端口 ${desiredPort} 被占用，选择操作：`,
                        choices: [
                            {
                                name: '杀死占用进程并继续（推荐）',
                                value: 'kill',
                            },
                            { name: '取消启动', value: 'abort' },
                            {
                                name: '继续启动（不杀进程，可能失败）',
                                value: 'continue',
                            },
                        ],
                    },
                ]);

                if (answer.action === 'abort') {
                    console.log('已取消启动。');
                    process.exit(0);
                }

                if (answer.action === 'kill') {
                    if (!pids || pids.length === 0) {
                        console.error(
                            '未找到占用 PID，无法自动杀进程，请手动处理后重试。'
                        );
                        process.exit(1);
                    }
                    console.log(`尝试杀死 PID: ${pids.join(', ')}`);
                    const ok = await killPids(pids);
                    if (!ok) {
                        console.error('杀进程失败，取消启动。');
                        process.exit(1);
                    }
                    // 等待端口释放
                    await new Promise((r) => setTimeout(r, 800));
                    const still = await checkPortInUse(desiredPort);
                    if (still) {
                        console.error('端口仍被占用，取消启动。');
                        process.exit(1);
                    }
                    console.log('端口已释放，继续启动...');
                } else {
                    console.log(
                        '继续启动（不杀进程），如遇 EADDRINUSE 请手动处理。'
                    );
                }
            } else {
                console.error(
                    '当前非交互终端，无法进行交互式端口处理。请手动释放端口后重试。'
                );
                process.exit(1);
            }
        }

        // 启动服务并监听错误事件（以便捕获 EADDRINUSE）
        const server = app.listen(PORT, () => {
            console.log(`服务器运行在 http://localhost:${PORT}`);
            console.log(`环境：${process.env.NODE_ENV ?? 'development'}`);
        });

        server.on('error', async (err: any) => {
            if (err?.code === 'EADDRINUSE') {
                console.error(`错误：端口 ${PORT} 已被占用（EADDRINUSE）。`);
                if (process.stdin && process.stdin.isTTY) {
                    const pids = await getPidsByPort(PORT);
                    console.log(`占用 PID: ${pids.join(', ')}`);
                    const ans = await inquirer.prompt([
                        {
                            type: 'confirm',
                            name: 'kill',
                            message: '是否杀死占用进程并重试？',
                            default: false,
                        },
                    ]);
                    if (ans.kill) {
                        const ok = await killPids(pids);
                        if (ok) {
                            console.log('已杀死进程，正在重试启动...');
                            // 重试一次
                            try {
                                server.close?.();
                            } catch (e) {
                                // Ignore close errors
                            }
                            await new Promise((r) => setTimeout(r, 500));
                            try {
                                app.listen(PORT, () =>
                                    console.log(
                                        `服务器运行在 http://localhost:${PORT}`
                                    )
                                );
                            } catch (e) {
                                console.error('重试启动失败：', e);
                                process.exit(1);
                            }
                        } else {
                            console.error('杀进程失败，退出。');
                            process.exit(1);
                        }
                    } else {
                        console.error('取消操作，退出。');
                        process.exit(1);
                    }
                }
            } else {
                console.error('服务器监听错误:', err);
            }
        });

        // 添加错误处理，避免 floating promise
        process.on('unhandledRejection', (reason) => {
            console.error('未处理的 Promise 拒绝:', reason);
        });
    } catch (error) {
        console.error('服务器启动失败:', error);
        process.exit(1);
    }
}

void startServer();

export default app;
