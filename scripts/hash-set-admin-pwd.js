const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const uri = process.env.DB_MONGODB_URI_DEV || 'mongodb://localhost:27017/library_booking_dev';
(async ()=>{
  await mongoose.connect(uri);
  const users = mongoose.connection.collection('users');
  const username = 'e2e_admin';
  const pwd = 'e2e_admin';
  const hash = await bcrypt.hash(pwd, 10);
  await users.updateOne({ username }, { $set: { password: hash, updatedAt: new Date() } });
  console.log('Set hashed password for', username);
  await mongoose.disconnect();
})().catch(e=>{ console.error(e); process.exit(1); });
