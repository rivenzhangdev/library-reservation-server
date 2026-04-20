/**
 * MongoDB 初始化脚本（最小化模式）
 * - 创建必要集合
 * - 确保每个环境都有默认超级管理员 ray.zhang
 * - 不再自动插入测试活动/通知/普通测试用户
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

const DEFAULT_ADMIN_USERNAME = 'ray.zhang';
const DEFAULT_ADMIN_NAME = 'Ray Zhang';

function getArgValue(prefix) {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

const adminPassword =
  getArgValue('--admin-password=') ||
  process.env.DEFAULT_SUPER_ADMIN_PASSWORD ||
  'Zrb20040801.';

const envs = [
  {
    key: 'development',
    name: '开发环境',
    dbName: 'library_booking_dev',
    uri:
      process.env.DB_MONGODB_URI_DEV ||
      process.env.DB_MONGODB_URI ||
      'mongodb://localhost:27017/library_booking_dev',
  },
  {
    key: 'test',
    name: '测试环境',
    dbName: 'library_booking_test',
    uri:
      process.env.DB_MONGODB_URI_TEST ||
      'mongodb://localhost:27017/library_booking_test',
  },
  {
    key: 'uat',
    name: 'UAT 环境',
    dbName: 'library_booking_uat',
    uri:
      process.env.DB_MONGODB_URI_UAT ||
      'mongodb://localhost:27017/library_booking_uat',
  },
  {
    key: 'production',
    name: '生产环境',
    dbName: 'library_booking',
    uri:
      process.env.DB_MONGODB_URI_PROD ||
      'mongodb://localhost:27017/library_booking',
  },
];

const userSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true },
    password: String,
    name: String,
    avatar: String,
    studentId: String,
    role: { type: Number, default: 0 },
    isSuperAdmin: { type: Boolean, default: false },
    creditScore: { type: Number, default: 100 },
    blacklisted: { type: Boolean, default: false },
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

function clearModelCache() {
  Object.keys(mongoose.models).forEach((key) => {
    delete mongoose.models[key];
  });
  if (mongoose.connection && mongoose.connection.models) {
    Object.keys(mongoose.connection.models).forEach((key) => {
      delete mongoose.connection.models[key];
    });
  }
}

async function ensureSuperAdmin(UserModel) {
  const existing = await UserModel.findOne({ username: DEFAULT_ADMIN_USERNAME });
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  if (!existing) {
    await UserModel.create({
      username: DEFAULT_ADMIN_USERNAME,
      password: passwordHash,
      name: DEFAULT_ADMIN_NAME,
      role: 1,
      isSuperAdmin: true,
      creditScore: 100,
      blacklisted: false,
    });
    return { created: true, username: DEFAULT_ADMIN_USERNAME };
  }

  existing.password = passwordHash;
  existing.role = 1;
  existing.isSuperAdmin = true;
  if (!existing.name) existing.name = DEFAULT_ADMIN_NAME;
  if (existing.creditScore === undefined || existing.creditScore === null) {
    existing.creditScore = 100;
  }
  if (existing.blacklisted === undefined || existing.blacklisted === null) {
    existing.blacklisted = false;
  }
  await existing.save();
  return { created: false, username: DEFAULT_ADMIN_USERNAME };
}

async function initializeMongoDB() {
  let successCount = 0;
  let failedCount = 0;

  console.log(
    `${colors.blue}========================================${colors.reset}`
  );
  console.log(
    `${colors.blue}  MongoDB 数据库初始化（最小化）          ${colors.reset}`
  );
  console.log(
    `${colors.blue}========================================${colors.reset}\n`
  );
  console.log(
    `${colors.yellow}说明：默认不再插入测试活动/通知/普通测试用户。${colors.reset}`
  );
  console.log(
    `${colors.yellow}      各环境仅确保存在超级管理员 ${DEFAULT_ADMIN_USERNAME}。${colors.reset}\n`
  );

  for (const env of envs) {
    try {
      console.log(`正在初始化 ${env.name} (${env.dbName})...`);
      await mongoose.connect(env.uri, {
        autoIndex: false,
        serverSelectionTimeoutMS: 8000,
      });

      const User = mongoose.model('User', userSchema);
      const Notification = mongoose.model('Notification', notificationSchema);
      const Activity = mongoose.model('Activity', activitySchema);
      const CreditRecord = mongoose.model('CreditRecord', creditRecordSchema);
      const Feedback = mongoose.model('Feedback', feedbackSchema);

      await Promise.all([
        User.collection.countDocuments(),
        Notification.collection.countDocuments(),
        Activity.collection.countDocuments(),
        CreditRecord.collection.countDocuments(),
        Feedback.collection.countDocuments(),
      ]);

      const adminResult = await ensureSuperAdmin(User);

      const collections = await mongoose.connection.db.collections();
      const collectionNames = collections
        .map((col) => col.collectionName)
        .sort();

      console.log(`${colors.green}✅ ${env.name} 初始化成功${colors.reset}`);
      console.log(`   超级管理员: ${adminResult.username}`);
      console.log(
        `   管理员状态: ${adminResult.created ? '已创建' : '已更新'}（密码已刷新）`
      );
      console.log('   已创建的集合:');
      collectionNames.forEach((name) => {
        console.log(`     - ${name}`);
      });

      successCount += 1;
    } catch (error) {
      console.log(`${colors.red}❌ ${env.name} 初始化失败${colors.reset}`);
      console.error(`${colors.red}错误信息：${error.message}${colors.reset}`);
      failedCount += 1;
    } finally {
      try {
        if (mongoose.connection.readyState !== 0) {
          await mongoose.connection.close();
        }
      } catch (closeError) {
        // ignore close errors
      }
      clearModelCache();
      console.log('');
    }
  }

  console.log(
    `${colors.blue}========================================${colors.reset}`
  );
  console.log(
    `${colors.blue}  MongoDB 初始化完成                      ${colors.reset}`
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
}

if (require.main === module) {
  initializeMongoDB();
}

module.exports = { initializeMongoDB };
