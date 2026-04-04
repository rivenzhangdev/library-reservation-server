/**
 * Run this script to migrate existing MongoDB users' role from string to numeric enum.
 * Usage:
 *   node scripts/migrate-role-to-enum.js
 * It will map: 'user' -> 0, 'admin' -> 1. Make a backup before running.
 */
const mongoose = require('mongoose');
require('dotenv').config();

const getMongoDBUri = () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (process.env.DB_MONGODB_URI) return process.env.DB_MONGODB_URI;
  switch (nodeEnv) {
    case 'production':
      return process.env.DB_MONGODB_URI_PROD || 'mongodb://localhost:27017/library_booking';
    case 'uat':
      return process.env.DB_MONGODB_URI_UAT || 'mongodb://localhost:27017/library_booking_uat';
    case 'test':
      return process.env.DB_MONGODB_URI_TEST || 'mongodb://localhost:27017/library_booking_test';
    case 'development':
    default:
      return process.env.DB_MONGODB_URI_DEV || 'mongodb://localhost:27017/library_booking_dev';
  }
};

const MONGODB_URI = getMongoDBUri();

async function run() {
  console.log('Connecting to', MONGODB_URI);
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  console.log('Backing up users collection to users_backup_before_role_migration');
  try {
    await db.collection('users').aggregate([
      { $match: {} },
      { $out: 'users_backup_before_role_migration' }
    ]).toArray();
    console.log('Backup completed.');
  } catch (e) {
    console.warn('Backup to new collection failed or already exists, proceeding with caution.', e.message);
  }

  console.log("Updating 'admin' -> 1");
  const r1 = await db.collection('users').updateMany({ role: 'admin' }, { $set: { role: 1 } });
  console.log('Matched:', r1.matchedCount, 'Modified:', r1.modifiedCount);

  console.log("Updating 'user' -> 0");
  const r2 = await db.collection('users').updateMany({ role: 'user' }, { $set: { role: 0 } });
  console.log('Matched:', r2.matchedCount, 'Modified:', r2.modifiedCount);

  console.log("Updating 'guest' -> 0 (treat guests as regular users)");
  const r3 = await db.collection('users').updateMany({ role: 'guest' }, { $set: { role: 0 } });
  console.log('Matched:', r3.matchedCount, 'Modified:', r3.modifiedCount);

  console.log("Converting any remaining string roles to 0 (default USER)");
  const r4 = await db.collection('users').updateMany({ role: { $type: 'string' } }, { $set: { role: 0 } });
  console.log('Matched remaining string roles:', r4.matchedCount, 'Modified:', r4.modifiedCount);

  console.log('Double-check documents with string roles:');
  const leftovers = await db.collection('users').find({ role: { $type: 'string' } }).limit(10).toArray();
  console.log('Sample leftover docs:', leftovers.length);

  console.log('Migration done. Please restart server to pick up schema changes.');
  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
