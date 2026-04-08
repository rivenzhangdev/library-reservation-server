/**
 * MongoDB 数据库初始化脚本
 * 用于创建四个环境的初始集合和数据（可选）
 */

const mongoose = require('mongoose');
require('dotenv').config();

// 颜色代码
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
};

console.log(
    `${colors.blue}========================================${colors.reset}`
);
console.log(
    `${colors.blue}  MongoDB 数据库初始化                  ${colors.reset}`
);
console.log(
    `${colors.blue}========================================${colors.reset}\n`
);

// 四个环境的 MongoDB URI 配置 - 从环境变量读取
const envs = [
    {
        name: '开发环境',
        uri:
            process.env.DB_MONGODB_URI_DEV ||
            process.env.DB_MONGODB_URI ||
            'mongodb://localhost:27017/library_booking_dev',
        hasTestData: true,
        dbName: 'library_booking_dev',
    },
    {
        name: '测试环境',
        uri:
            process.env.DB_MONGODB_URI_TEST ||
            'mongodb://localhost:27017/library_booking_test',
        hasTestData: true,
        dbName: 'library_booking_test',
    },
    {
        name: 'UAT 环境',
        uri:
            process.env.DB_MONGODB_URI_UAT ||
            'mongodb://localhost:27017/library_booking_uat',
        hasTestData: false,
        dbName: 'library_booking_uat',
    },
    {
        name: '生产环境',
        uri:
            process.env.DB_MONGODB_URI_PROD ||
            'mongodb://localhost:27017/library_booking',
        hasTestData: false,
        dbName: 'library_booking',
    },
];

// 定义 Schema
const userSchema = new mongoose.Schema(
    {
        username: { type: String, unique: true },
        password: String,
        name: String,
        avatar: String,
        studentId: String,
        role: { type: String, default: 'user' },
        creditScore: { type: Number, default: 100 },
        isOpenidVerified: Boolean,
        favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Seat' }],
        activityRegistrations: [
            {
                activity: mongoose.Schema.Types.ObjectId,
                registeredAt: Date,
            },
        ],
    },
    { timestamps: true }
);

const notificationSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    title: String,
    content: String,
    type: { type: Number, enum: [0, 1, 2, 3, 4] },
    isRead: { type: Boolean, default: false },
    time: { type: Date, default: Date.now },
    relatedId: String,
});

const activitySchema = new mongoose.Schema(
    {
        title: String,
        description: String,
        coverImage: String,
        startTime: Date,
        endTime: Date,
        location: String,
        status: { type: Number, enum: [0, 1, 2], default: 0 },
        maxParticipants: { type: Number, default: 50 },
        participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        rules: [String],
        awards: [String],
    },
    { timestamps: true }
);

const creditRecordSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    changeAmount: Number,
    reason: String,
    type: { type: Number },
    createdAt: { type: Date, default: Date.now },
});

const feedbackSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    typeId: { type: Number, enum: [1, 2, 3, 4] },
    urgencyId: { type: Number, enum: [1, 2, 3, 4] },
    title: String,
    description: String,
    contact: String,
    images: [String],
    status: { type: Number, enum: [1, 2, 3, 4], default: 1 },
    reply: String,
    repliedBy: mongoose.Schema.Types.ObjectId,
    replyAt: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

async function initializeMongoDB() {
    let successCount = 0;
    let failedCount = 0;

    console.log(
        `${colors.yellow}[1/1] 开始初始化 MongoDB 数据库...${colors.reset}\n`
    );

    for (const env of envs) {
        try {
            console.log(`正在初始化 ${env.name} (${env.dbName})...`);

            // 连接到对应的数据库
            await mongoose.connect(env.uri);

            // 创建模型并初始化集合
            const User = mongoose.model('User', userSchema);
            const Notification = mongoose.model(
                'Notification',
                notificationSchema
            );
            const Activity = mongoose.model('Activity', activitySchema);
            const CreditRecord = mongoose.model(
                'CreditRecord',
                creditRecordSchema
            );
            const Feedback = mongoose.model('Feedback', feedbackSchema);

            // 显式创建集合（如果不存在）
            await Promise.all([
                User.collection.countDocuments(),
                Notification.collection.countDocuments(),
                Activity.collection.countDocuments(),
                CreditRecord.collection.countDocuments(),
                Feedback.collection.countDocuments(),
            ]);

            // 如果是开发或测试环境，插入一些测试数据
            if (env.hasTestData) {
                console.log(`   正在插入测试数据...`);

                // 检查是否已有数据
                const userCount = await User.countDocuments();
                if (userCount === 0) {
                    // 创建测试用户
                    await User.create([
                        {
                            username: 'admin',
                            password:
                                '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', // admin123
                            name: '管理员',
                            studentId: '000001',
                            role: 1,
                            creditScore: 100,
                        },
                        {
                            username: 'user1',
                            password:
                                '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', // admin123
                            name: '测试用户 1',
                            studentId: '2024001',
                            role: 0,
                            creditScore: 100,
                        },
                        {
                            username: 'user2',
                            password:
                                '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', // admin123
                            name: '测试用户 2',
                            studentId: '2024002',
                            role: 0,
                            creditScore: 100,
                        },
                    ]);

                    // 创建测试活动
                    const activities = await Activity.create([
                        {
                            title: '图书馆读书分享会',
                            description:
                                '每月一度的读书分享活动，欢迎大家积极参与',
                            startTime: new Date(
                                Date.now() + 7 * 24 * 60 * 60 * 1000
                            ), // 一周后
                            endTime: new Date(
                                Date.now() + 14 * 24 * 60 * 60 * 1000
                            ), // 两周后
                            location: '图书馆三楼报告厅',
                            status: 0, // upcoming
                            maxParticipants: 50,
                            rules: ['准时到场', '保持安静', '积极参与讨论'],
                            awards: ['精美书签', '购书券'],
                        },
                        {
                            title: '信息素养培训讲座',
                            description: '学习如何高效检索学术资源',
                            startTime: new Date(
                                Date.now() + 3 * 24 * 60 * 60 * 1000
                            ), // 三天后
                            endTime: new Date(
                                Date.now() +
                                    3 * 24 * 60 * 60 * 1000 +
                                    2 * 60 * 60 * 1000
                            ), // 2 小时后
                            location: '图书馆二楼会议室',
                            status: 0, // upcoming
                            maxParticipants: 100,
                            rules: ['携带笔记本电脑', '提前入场'],
                            awards: ['培训证书'],
                        },
                    ]);

                    // 创建测试通知
                    const users = await User.find({ role: 0 });
                    if (users.length > 0) {
                        await Notification.create([
                            {
                                userId: users[0]._id,
                                title: '欢迎使用图书馆系统',
                                content: '感谢您的注册，祝您使用愉快！',
                                type: 3, // system
                                isRead: false,
                            },
                            {
                                userId: users[0]._id,
                                title: '活动提醒',
                                content: '您报名的读书分享会将于明天举行',
                                type: 2, // activity
                                isRead: false,
                                relatedId: activities[0]._id.toString(),
                            },
                        ]);
                    }

                    console.log(
                        `   ${colors.green}✅ 测试数据插入成功${colors.reset}`
                    );
                } else {
                    console.log(
                        `   ${colors.yellow}⚠️  已存在数据，跳过插入${colors.reset}`
                    );
                }
            }

            // 验证集合是否创建成功
            const collections = await mongoose.connection.db.collections();
            const collectionNames = collections
                .map((col) => col.collectionName)
                .sort();

            console.log(
                `${colors.green}✅ ${env.name} 初始化成功${colors.reset}`
            );
            console.log(`   已创建的集合:`);
            collectionNames.forEach((name) => {
                console.log(`     - ${name}`);
            });

            if (!env.hasTestData) {
                console.log(`   ${colors.yellow}⚠️  无测试数据${colors.reset}`);
            } else {
                console.log(`   ${colors.green}✅ 包含测试数据${colors.reset}`);
            }

            // 清除缓存的模型，以便下次循环重新创建
            Object.keys(mongoose.models).forEach((key) => {
                delete mongoose.models[key];
            });

            // 断开连接
            await mongoose.connection.close();
            successCount++;
            console.log('');
        } catch (error) {
            console.log(
                `${colors.red}❌ ${env.name} 初始化失败${colors.reset}`
            );
            console.error(
                `${colors.red}错误信息：${error.message}${colors.reset}\n`
            );
            failedCount++;
        }
    }

    // 总结
    console.log(
        `${colors.blue}========================================${colors.reset}`
    );
    console.log(
        `${colors.blue}  MongoDB 初始化完成！                    ${colors.reset}`
    );
    console.log(
        `${colors.blue}========================================${colors.reset}\n`
    );

    console.log(
        `${colors.green}✅ 成功：${successCount} 个 MongoDB 数据库${colors.reset}`
    );
    if (failedCount > 0) {
        console.log(
            `${colors.red}❌ 失败：${failedCount} 个 MongoDB 数据库${colors.reset}`
        );
    }
    console.log('');

    console.log(`${colors.yellow}已创建的数据库:${colors.reset}`);
    envs.forEach((env) => {
        const db = env.uri.split('/').pop();
        const testDataMark = env.hasTestData
            ? ' (含测试数据)'
            : ' (无测试数据)';
        console.log(`  - ${db}${colors.yellow}${testDataMark}${colors.reset}`);
    });
    console.log('');
}

// 根据命令行参数决定是否执行
if (require.main === module) {
    initializeMongoDB();
}

module.exports = { initializeMongoDB };
