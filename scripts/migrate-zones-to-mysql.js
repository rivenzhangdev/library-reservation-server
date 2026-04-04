const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGO = process.env.MONGO_URI || 'mongodb://localhost:27017/library_booking_dev';

async function main() {
  console.log('Connecting to MongoDB...', MONGO);
  await mongoose.connect(MONGO);
  const ZoneMongo = mongoose.connection.collection('zones');

  // Use mysql2 to insert zones and update seats
  const mysql = require('mysql2/promise');

  // derive MySQL config similar to src/database/mysql.ts
  const nodeEnv = process.env.NODE_ENV || 'development';
  const dbName = process.env.DB_MYSQL_DATABASE || (nodeEnv === 'development' ? (process.env.DB_MYSQL_DATABASE_DEV || 'library_booking_dev') : (process.env.DB_MYSQL_DATABASE_DEV || 'library_booking_dev'));
  const dbUser = process.env.DB_MYSQL_USER || 'root';
  const dbPassword = process.env.DB_MYSQL_PASSWORD || '';
  const dbHost = process.env.DB_MYSQL_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_MYSQL_PORT || '3306');

  const pool = await mysql.createPool({ host: dbHost, user: dbUser, database: dbName, password: dbPassword, port: dbPort, connectionLimit: 5 });

  // Ensure zones table exists (simple DDL)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      status TINYINT DEFAULT 1,
      created_at DATETIME NULL,
      updated_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const zones = await ZoneMongo.find({}).toArray();
  console.log('Found', zones.length, 'mongo zones');
  const nameToId = {};
  for (const z of zones) {
    const now = new Date();
    const [res] = await pool.query('INSERT INTO zones (name, description, created_at, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)', [z.name, z.description || '', now, now]);
    // mysql2 returns insertId
    const insertId = res.insertId || (await (async () => { const [rows] = await pool.query('SELECT id FROM zones WHERE name = ?', [z.name]); return rows[0]?.id; })());
    nameToId[z.name] = insertId;
    console.log('Inserted/Found zone:', z.name, '-> id', insertId);
  }

  // Update seats: map seat.zone (string) to zoneId
  const [seats] = await pool.query('SELECT id, zone FROM seats WHERE zone IS NOT NULL AND zone <> ""');
  // ensure zoneId column exists
  const [colRows] = await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'seats' AND COLUMN_NAME = 'zoneId'", [dbName]);
  if (!colRows || colRows.length === 0) {
    await pool.query('ALTER TABLE seats ADD COLUMN zoneId INT NULL');
    console.log('Added seats.zoneId column');
  }
  for (const row of seats) {
    const zoneName = row.zone;
    const zoneId = nameToId[zoneName];
    if (zoneId) {
      await pool.query('UPDATE seats SET zoneId = ? WHERE id = ?', [zoneId, row.id]);
      console.log('Updated seat', row.id, 'zone ->', zoneId);
    }
  }

  await pool.end();

  console.log('Migration finished');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
