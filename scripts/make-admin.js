const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const MONGO = process.env.MONGO_URI || 'mongodb://localhost:27017/library_booking_dev';
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: node make-admin.js <username>');
    process.exit(2);
  }

  await mongoose.connect(MONGO);
  const col = mongoose.connection.collection('users');

  // Try to find existing user
  let user = await col.findOne({ username });
  if (!user) {
    console.log('User not found, creating...');
    const now = new Date();
    const doc = {
      username,
      password: username,
      name: 'Admin',
      role: 'admin',
      creditScore: 100,
      blacklisted: false,
      settings: {},
      favorites: [],
      activityRegistrations: [],
      createdAt: now,
      updatedAt: now,
    };
    const res = await col.insertOne(doc);
    user = await col.findOne({ _id: res.insertedId });
  } else {
    await col.updateOne({ _id: user._id }, { $set: { role: 'admin', updatedAt: new Date() } });
    user = await col.findOne({ _id: user._id });
  }

  const token = jwt.sign({ id: user._id.toString(), username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  console.log('Admin user:', user.username);
  console.log('JWT token:', token);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
