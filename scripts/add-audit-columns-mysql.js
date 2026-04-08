#!/usr/bin/env node
/*
  脚本：为 MySQL 表添加审计字段 `created_by` 和 `updated_by`，并可选回填已有记录。

  使用：
    node scripts/add-audit-columns-mysql.js        # 直接运行（会对数据库应用修改）
    AUDIT_DRY_RUN=true node scripts/add-audit-columns-mysql.js   # 仅打印将要执行的操作
    AUDIT_BACKFILL_USER=<userId> node scripts/add-audit-columns-mysql.js  # 回填已有记录为指定 userId
    AUDIT_TABLES=bookings,zones node scripts/add-audit-columns-mysql.js  # 仅作用于指定表

  注意：在生产环境运行前请备份数据库。脚本会根据当前 `src/database/mysql` 的配置连接数据库。
*/

const path = require('path');
const fs = require('fs');

// 加载 .env
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // ignore
}

const sequelize = require(path.join(__dirname, '..', 'src', 'database', 'mysql')).default;

const DEFAULT_TABLES = ['bookings', 'zones', 'seats', 'floors', 'time_slot_status'];

async function hasColumn(dbName, table, column) {
  const sql = `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`;
  const [rows] = await sequelize.query(sql, { replacements: [dbName, table, column] });
  const first = rows && rows[0];
  const cnt = first ? (first.cnt || first.CNT || Object.values(first)[0]) : 0;
  return Number(cnt) > 0;
}

async function main() {
  try {
    await sequelize.authenticate();
    const dbName = (sequelize && sequelize.config && (sequelize.config.database || sequelize.config.databaseName)) || process.env.DB_MYSQL_DATABASE || process.env.DB_MYSQL_DATABASE_DEV;
    console.log('Connected to MySQL database:', dbName);

    const tablesEnv = process.env.AUDIT_TABLES;
    const tables = tablesEnv ? tablesEnv.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_TABLES;
    const backfillUser = process.env.AUDIT_BACKFILL_USER || '';
    const dryRun = process.env.AUDIT_DRY_RUN === 'true' || process.argv.includes('--dry-run');

    for (const table of tables) {
      console.log('\n=> Table:', table);
      const hasCreatedBy = await hasColumn(dbName, table, 'created_by');
      const hasUpdatedBy = await hasColumn(dbName, table, 'updated_by');
      console.log(`   has created_by: ${hasCreatedBy}, has updated_by: ${hasUpdatedBy}`);

      if (!hasCreatedBy || !hasUpdatedBy) {
        const alters = [];
        if (!hasCreatedBy) alters.push("ADD COLUMN `created_by` VARCHAR(255) NULL COMMENT '创建者 (audit)'");
        if (!hasUpdatedBy) alters.push("ADD COLUMN `updated_by` VARCHAR(255) NULL COMMENT '更新者 (audit)'");
        const alterSql = `ALTER TABLE \`${table}\` ${alters.join(', ')};`;
        console.log('   ALTER SQL:', alterSql);
        if (!dryRun) {
          await sequelize.query(alterSql);
          console.log('   -> Alter applied');
        } else {
          console.log('   -> dry-run: not applied');
        }
      } else {
        console.log('   -> no alter needed');
      }

      if (backfillUser) {
        if (!dryRun) {
          console.log(`   -> Backfilling created_by (if null) -> ${backfillUser}`);
          await sequelize.query(`UPDATE \`${table}\` SET created_by = :u WHERE created_by IS NULL`, { replacements: { u: backfillUser } });
          console.log(`   -> Backfilling updated_by (if null) -> ${backfillUser}`);
          await sequelize.query(`UPDATE \`${table}\` SET updated_by = :u WHERE updated_by IS NULL`, { replacements: { u: backfillUser } });
        } else {
          console.log('   -> dry-run: would backfill created_by/updated_by with', backfillUser);
        }
      } else {
        console.log('   -> no backfill requested (set AUDIT_BACKFILL_USER env to enable)');
      }
    }

    console.log('\nAll done.');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
}

void main();
