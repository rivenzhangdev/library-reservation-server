const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const MONGO = process.env.MONGO_URI || 'mongodb://localhost:27017/library_booking_dev';

async function main() {
  const username = process.argv[2] || 'mock_openid_admin';
  const password = process.argv[3] || username;

  await mongoose.connect(MONGO);
  const col = mongoose.connection.collection('users');

  const hash = await bcrypt.hash(password, 10);
  const res = await col.updateOne({ username }, { $set: { password: hash, updatedAt: new Date() } });
  if (res.matchedCount === 0) {
    console.error('User not found:', username);
    process.exit(2);
  }
  console.log('Password updated for', username);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
