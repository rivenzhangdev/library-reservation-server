#!/usr/bin/env node
/*
  Script: add `icon` columns to seat config tables in MySQL and backfill defaults.

  Usage:
    node scripts/add-seat-config-icon-columns-mysql.js
    ICON_MIGRATION_DRY_RUN=true node scripts/add-seat-config-icon-columns-mysql.js

  Notes:
  - This script is safe to run multiple times (idempotent).
  - It uses current DB config from src/database/mysql.
*/

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_e) {
  // ignore dotenv load errors
}

const sequelize = require(path.join(__dirname, '..', 'src', 'database', 'mysql')).default;

const TABLES = [
  {
    name: 'seat_type_config',
    column: 'icon',
    alterSql:
      "ALTER TABLE `seat_type_config` ADD COLUMN `icon` VARCHAR(64) NOT NULL DEFAULT 'search' COMMENT 'Display icon key' AFTER `label`;",
    backfillSql: [
      "UPDATE `seat_type_config` SET `icon` = 'location-o' WHERE LOWER(TRIM(`value`)) = 'single';",
      "UPDATE `seat_type_config` SET `icon` = 'friends-o' WHERE LOWER(TRIM(`value`)) = 'double';",
      "UPDATE `seat_type_config` SET `icon` = 'cluster-o' WHERE LOWER(TRIM(`value`)) = 'group';",
      "UPDATE `seat_type_config` SET `icon` = 'passed' WHERE LOWER(TRIM(`value`)) = 'open';",
      "UPDATE `seat_type_config` SET `icon` = 'search' WHERE `icon` IS NULL OR TRIM(`icon`) = '';",
    ],
  },
  {
    name: 'seat_facility_config',
    column: 'icon',
    alterSql:
      "ALTER TABLE `seat_facility_config` ADD COLUMN `icon` VARCHAR(64) NOT NULL DEFAULT 'search' COMMENT 'Display icon key' AFTER `label`;",
    backfillSql: [
      "UPDATE `seat_facility_config` SET `icon` = 'underway-o' WHERE LOWER(TRIM(`key`)) IN ('power','socket','hassocket','has_socket');",
      "UPDATE `seat_facility_config` SET `icon` = 'photo-o' WHERE LOWER(TRIM(`key`)) IN ('window','iswindow','is_window');",
      "UPDATE `seat_facility_config` SET `icon` = 'search' WHERE `icon` IS NULL OR TRIM(`icon`) = '';",
    ],
  },
];

async function hasColumn(dbName, table, column) {
  const sql =
    'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?';
  const [rows] = await sequelize.query(sql, {
    replacements: [dbName, table, column],
  });
  const first = rows && rows[0];
  const cnt = first ? first.cnt || first.CNT || Object.values(first)[0] : 0;
  return Number(cnt) > 0;
}

async function main() {
  try {
    await sequelize.authenticate();
    const dbName =
      (sequelize && sequelize.config && (sequelize.config.database || sequelize.config.databaseName)) ||
      process.env.DB_MYSQL_DATABASE ||
      process.env.DB_MYSQL_DATABASE_DEV;

    const dryRun = process.env.ICON_MIGRATION_DRY_RUN === 'true' || process.argv.includes('--dry-run');

    console.log('Connected to MySQL database:', dbName);
    console.log('Dry run mode:', dryRun ? 'ON' : 'OFF');

    for (const item of TABLES) {
      console.log('\n=> Table:', item.name);
      const exists = await hasColumn(dbName, item.name, item.column);
      console.log(`   has ${item.column}: ${exists}`);

      if (!exists) {
        console.log('   ALTER SQL:', item.alterSql);
        if (!dryRun) {
          await sequelize.query(item.alterSql);
          console.log('   -> Alter applied');
        } else {
          console.log('   -> dry-run: not applied');
        }
      } else {
        console.log('   -> no alter needed');
      }

      for (const sql of item.backfillSql) {
        if (!dryRun) {
          await sequelize.query(sql);
          console.log('   -> Backfill SQL applied');
        } else {
          console.log('   -> dry-run backfill SQL:', sql);
        }
      }
    }

    console.log('\nAll done.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error && error.stack ? error.stack : error);
    process.exit(2);
  }
}

void main();
