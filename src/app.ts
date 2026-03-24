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

// 导入数据库连接
import { testConnection, syncDatabase } from './database/mysql';
import { connectMongoDB } from './database/mongodb';

// 导入模型关系配置
import { setupMySQLModelRelations } from './models/mysql/relations';

dotenv.config();

const app = new Koa();
const PORT = process.env.PORT ?? 3000;

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
            console.log(`服务器运行在 http://localhost:${PORT ?? 3000}`);
            console.log(`环境：${process.env.NODE_ENV ?? 'development'}`);
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
