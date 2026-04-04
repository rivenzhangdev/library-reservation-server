const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/library_booking_dev';

async function run() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to', MONGO_URI);
  const users = mongoose.connection.collection('users');
  const res = await users.updateOne({ username: 'ray.zhang' }, { $set: { role: 'admin' } }, { upsert: false });
  console.log('MatchedCount:', res.matchedCount || res.matched || res.result);
  console.log('ModifiedCount:', res.modifiedCount || res.modified || res.result);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
