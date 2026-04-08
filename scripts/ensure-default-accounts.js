const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const MONGO = process.env.MONGO_URI || 'mongodb://localhost:27017/library_booking_dev';

async function ensureUser(col, { username, password, name, role }) {
  const now = new Date();
  const existing = await col.findOne({ username });
  const hash = password ? await bcrypt.hash(password, 10) : null;

  const normalizeRole = (r) => {
    if (typeof r === 'number') return r;
    if (typeof r === 'string') return r === 'admin' ? 1 : 0;
    return 0;
  };

  if (!existing) {
    const doc = {
      username,
      password: hash,
      name: name || username,
      role: normalizeRole(role),
      creditScore: 100,
      blacklisted: false,
      settings: {},
      favorites: [],
      activityRegistrations: [],
      createdAt: now,
      updatedAt: now,
    };
    const res = await col.insertOne(doc);
    return await col.findOne({ _id: res.insertedId });
  } else {
    const update = { role: normalizeRole(role) ?? existing.role, updatedAt: now };
    if (hash) update.password = hash;
    if (name) update.name = name;
    await col.updateOne({ _id: existing._id }, { $set: update });
    return await col.findOne({ _id: existing._id });
  }
}

async function main() {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  const col = mongoose.connection.collection('users');

  console.log('Ensuring default accounts in', MONGO);

  // Guest account
  const guest = await ensureUser(col, {
    username: 'guest',
    password: null, // guest has no password
    name: '游客',
    role: 0,
  });
  console.log('Guest ensured:', guest.username);

  // Admin account specified by the user
  const adminPassword = process.argv[2] || 'Zrb20040801.';
  const admin = await ensureUser(col, {
    username: 'ray.zhang',
    password: adminPassword,
    name: 'Ray Zhang',
    role: 1,
  });
  console.log('Admin ensured:', admin.username);

  console.log('Default accounts ensured. Admin login:', 'ray.zhang', 'Password:', adminPassword);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
