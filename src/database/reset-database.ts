/**
 * 数据库重置和初始化工具
 * 用于删除旧表并重新创建（使用新的数字类型）
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function resetAndInitializeDatabase() {
    console.log('=====================================');
    console.log('  MySQL 数据库重置工具');
    console.log('=====================================\n');

    const dbConfig = {
        host: process.env.DB_MYSQL_HOST ?? 'localhost',
        port: parseInt(process.env.DB_MYSQL_PORT ?? '3306'),
        user: process.env.DB_MYSQL_USER ?? 'root',
        password: process.env.DB_MYSQL_PASSWORD ?? '',
    };

    let connection;

    try {
        // 1. 连接到 MySQL 服务器
        console.log('[1/6] 连接到 MySQL 服务器...');
        connection = await mysql.createConnection({
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            password: dbConfig.password,
        });
        console.log('✓ MySQL 服务器连接成功\n');

        // 2. 切换到 library_booking 数据库
        console.log('[2/6] 切换到 library_booking 数据库...');
        await connection.changeUser({ database: 'library_booking' });
        console.log('✓ 数据库切换成功\n');

        // 3. 删除所有表（外键约束处理）
        console.log('[3/6] 删除旧表...');
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        await connection.query('DROP TABLE IF EXISTS time_slot_status');
        await connection.query('DROP TABLE IF EXISTS bookings');
        await connection.query('DROP TABLE IF EXISTS seats');
        await connection.query('DROP TABLE IF EXISTS floors');
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('✓ 旧表已删除\n');

        // 4. 读取并执行初始化 SQL 脚本
        console.log('[4/6] 执行初始化脚本...');
        const initSqlPath = path.join(__dirname, '../../database/init.sql');

        if (!fs.existsSync(initSqlPath)) {
            throw new Error(`初始化文件不存在：${initSqlPath}`);
        }

        const initSql = fs.readFileSync(initSqlPath, 'utf-8');

        // 按行读取，跳过注释
        const lines = initSql.split('\n');
        let currentStatement = '';

        for (const line of lines) {
            const trimmedLine = line.trim();

            // 跳过空行和注释
            if (!trimmedLine || trimmedLine.startsWith('--')) {
                continue;
            }

            currentStatement += line + '\n';

            // 如果以分号结尾，执行该语句
            if (trimmedLine.endsWith(';')) {
                try {
                    await connection.query(currentStatement);
                    currentStatement = '';
                } catch (error: any) {
                    // 忽略表已存在的错误
                    if (error.code === 'ER_TABLE_EXISTS_ERROR') {
                        console.log(`  ⚠ 表已存在，跳过`);
                    } else {
                        throw error;
                    }
                }
            }
        }

        console.log('✓ 数据库表初始化完成\n');

        // 5. 验证表结构
        console.log('[5/6] 验证表结构...');
        const [tables] = await connection.query('SHOW TABLES');
        console.log('✓ 已创建的表:');
        (tables as any[]).forEach((table: any) => {
            const tableName = Object.values(table)[0];
            console.log(`  - ${tableName}`);
        });
        console.log('');

        // 6. 查看表结构
        console.log('[6/6] 查看 seats 表结构...');
        const [seatsColumns] = await connection.query('DESCRIBE seats');
        console.log('seats 表字段:');
        (seatsColumns as any[]).forEach((col: any) => {
            console.log(`  ${col.Field}: ${col.Type} (${col.Comment})`);
        });
        console.log('');

        console.log('=====================================');
        console.log('  ✓ 数据库重置完成!');
        console.log('=====================================\n');

        console.log('现在可以运行以下命令测试连接:');
        console.log('  pnpm db:test\n');
        console.log('或启动项目:');
        console.log('  pnpm dev\n');
    } catch (error: any) {
        console.error('✗ 数据库重置失败');
        console.error('错误信息:', error.message);
        console.error('\n请检查:');
        console.error('1. MySQL 服务是否已启动');
        console.error('2. .env 文件中的 DB_MYSQL_PASSWORD 是否正确');
        console.error('3. 是否有权限操作数据库\n');
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// 运行重置和初始化
void resetAndInitializeDatabase();
