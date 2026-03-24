import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// 根据 NODE_ENV 自动选择对应的 MongoDB URI
const getMongoDBUri = () => {
    const nodeEnv = process.env.NODE_ENV ?? 'development';

    // 优先使用直接配置的 URI
    if (process.env.DB_MONGODB_URI) {
        return process.env.DB_MONGODB_URI;
    }

    // 根据环境选择对应的数据库
    switch (nodeEnv) {
        case 'production':
            return (
                process.env.DB_MONGODB_URI_PROD ??
                'mongodb://localhost:27017/library_booking'
            );
        case 'uat':
            return (
                process.env.DB_MONGODB_URI_UAT ??
                'mongodb://localhost:27017/library_booking_uat'
            );
        case 'test':
            return (
                process.env.DB_MONGODB_URI_TEST ??
                'mongodb://localhost:27017/library_booking_test'
            );
        case 'development':
        default:
            return (
                process.env.DB_MONGODB_URI_DEV ??
                'mongodb://localhost:27017/library_booking_dev'
            );
    }
};

const MONGODB_URI = getMongoDBUri();

export async function connectMongoDB() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log(`MongoDB 数据库连接成功 (${MONGODB_URI})`);

        // 监听连接事件
        mongoose.connection.on('error', (error) => {
            console.error('MongoDB 连接错误:', error);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB 连接断开');
        });

        // 优雅关闭
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB 连接已关闭');
            process.exit(0);
        });
    } catch (error) {
        console.error('MongoDB 数据库连接失败:', error);
        throw error;
    }
}

export default mongoose;
