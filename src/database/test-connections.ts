import dotenv from 'dotenv';
import { connectMongoDB } from './mongodb';
import { testConnection } from './mysql';

dotenv.config();

async function testAllConnections() {
    console.log('========================================');
    console.log('  数据库连接测试');
    console.log('========================================\n');

    console.log(`当前环境：${process.env.NODE_ENV ?? 'development'}\n`);

    // 测试 MySQL 连接
    console.log('正在测试 MySQL 连接...');
    try {
        await testConnection();
        console.log('✅ MySQL 连接成功\n');
    } catch (_error) {
        console.error('❌ MySQL 连接失败\n');
    }

    // 测试 MongoDB 连接
    console.log('正在测试 MongoDB 连接...');
    try {
        await connectMongoDB();
        console.log('✅ MongoDB 连接成功\n');

        // 关闭连接
        const mongoose = await import('./mongodb');
        await mongoose.default.connection.close();
    } catch (_error) {
        console.error('❌ MongoDB 连接失败\n');
    }

    console.log('========================================');
    console.log('  测试完成');
    console.log('========================================\n');
}

testAllConnections().catch(console.error);
