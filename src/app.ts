import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import dotenv from 'dotenv';

// 导入中间件
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error';

// 导入路由
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import seatRoutes from './routes/seats';
import bookingRoutes from './routes/booking';
import notificationRoutes from './routes/notification';
import activityRoutes from './routes/activity';
import feedbackRoutes from './routes/feedback';
import compatRoutes from './routes/compat';
import uploadsRoutes from './routes/uploads';
import uploadsAdminRoutes from './routes/uploads-admin';

// 导入数据库连接
import { testConnection, syncDatabase } from './database/mysql';
import { connectMongoDB } from './database/mongodb';
import Router from 'koa-router';

// 导入模型关系配置
import { setupMySQLModelRelations } from './models/mysql/relations';

dotenv.config();

const app = new Koa();
const PORT = Number(process.env.PORT) || 3000;
// Swagger 服务使用独立端口，默认取应用端口 + 1000，或由 SWAGGER_PORT 环境变量覆盖
const SWAGGER_PORT = Number(process.env.SWAGGER_PORT) || PORT + 1000;

// 使用中间件
app.use(errorHandler);
app.use(corsMiddleware);
app.use(bodyParser());

// 注册路由
app.use(authRoutes.routes()).use(authRoutes.allowedMethods());

app.use(userRoutes.routes()).use(userRoutes.allowedMethods());

app.use(seatRoutes.routes()).use(seatRoutes.allowedMethods());

app.use(bookingRoutes.routes()).use(bookingRoutes.allowedMethods());

app.use(notificationRoutes.routes()).use(notificationRoutes.allowedMethods());

app.use(activityRoutes.routes()).use(activityRoutes.allowedMethods());

app.use(feedbackRoutes.routes()).use(feedbackRoutes.allowedMethods());

// 静态上传文件服务 (simple)
app.use(uploadsRoutes.routes()).use(uploadsRoutes.allowedMethods());

// admin uploads management (includes public POST /api/uploads for compatibility)
app.use(uploadsAdminRoutes.routes()).use(uploadsAdminRoutes.allowedMethods());

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

        // 启动服务
        app.listen(PORT, () => {
            console.log(`服务器运行在 http://localhost:${PORT}`);
            console.log(`环境：${process.env.NODE_ENV ?? 'development'}`);
            console.log(
                `Swagger UI（独立端口）: http://localhost:${SWAGGER_PORT}/swagger-index.html`
            );
            console.log(
                `若要查看 API 文档并启动 Swagger UI，请运行：pnpm --filter library-reservation-server run swagger`
            );
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
