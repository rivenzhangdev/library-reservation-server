import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// 根据 NODE_ENV 自动选择对应的数据库配置
const getMySQLConfig = () => {
    const nodeEnv = process.env.NODE_ENV ?? 'development';

    // 如果直接配置了数据库，优先使用
    if (process.env.DB_MYSQL_DATABASE) {
        return {
            database: process.env.DB_MYSQL_DATABASE,
            user: process.env.DB_MYSQL_USER ?? 'root',
            password: process.env.DB_MYSQL_PASSWORD ?? '',
            host: process.env.DB_MYSQL_HOST ?? 'localhost',
            port: parseInt(process.env.DB_MYSQL_PORT ?? '3306'),
        };
    }

    // 根据环境选择对应的数据库
    let dbName: string;
    switch (nodeEnv) {
        case 'production':
            dbName = process.env.DB_MYSQL_DATABASE_PROD ?? 'library_booking';
            break;
        case 'uat':
            dbName = process.env.DB_MYSQL_DATABASE_UAT ?? 'library_booking_uat';
            break;
        case 'test':
            dbName =
                process.env.DB_MYSQL_DATABASE_TEST ?? 'library_booking_test';
            break;
        case 'development':
        default:
            dbName = process.env.DB_MYSQL_DATABASE_DEV ?? 'library_booking_dev';
            break;
    }

    return {
        database: dbName,
        user: process.env.DB_MYSQL_USER ?? 'root',
        password: process.env.DB_MYSQL_PASSWORD ?? '',
        host: process.env.DB_MYSQL_HOST ?? 'localhost',
        port: parseInt(process.env.DB_MYSQL_PORT ?? '3306'),
    };
};

const config = getMySQLConfig();

// 控制是否输出 SQL 日志：优先使用 MYSQL_LOGGING 环境变量（'true' / 'false'），
// 若未设置则保持旧行为（开发环境默认开启日志）。
const mysqlLoggingEnv = process.env.MYSQL_LOGGING;
const shouldLog =
    typeof mysqlLoggingEnv !== 'undefined'
        ? mysqlLoggingEnv === 'true'
        : process.env.NODE_ENV === 'development';

const sequelize = new Sequelize(config.database, config.user, config.password, {
    host: config.host,
    port: config.port,
    dialect: 'mysql',
    timezone: '+08:00',
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000,
    },
    define: {
        timestamps: true,
        underscored: true,
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
    },
    logging: shouldLog ? console.log : false,
});

// 测试连接
export async function testConnection() {
    try {
        await sequelize.authenticate();
        console.log(`MySQL 数据库连接成功 (${config.database})`);
    } catch (error) {
        console.error('MySQL 数据库连接失败:', error);
        throw error;
    }
}

// 同步数据库表结构
export async function syncDatabase(force = false) {
    try {
        await sequelize.sync({ force });
        console.log('数据库表同步完成');
    } catch (error) {
        console.error('数据库表同步失败:', error);
        throw error;
    }
}

export default sequelize;
