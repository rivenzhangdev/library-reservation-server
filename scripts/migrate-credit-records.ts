import dotenv from 'dotenv';
import { connectMongoDB } from '../src/database/mongodb';
import CreditRecord from '../src/models/mongodb/CreditRecord';
import { normalizeCreditReason } from '../src/constants/credit';

dotenv.config();

async function run() {
  await connectMongoDB();

  const conditions = {
    $or: [
      { reasonCode: { $exists: false } },
      { reasonText: { $exists: false } },
      { reasonCode: null },
      { reasonText: null },
    ],
  };

  const cursor = CreditRecord.find(conditions).cursor();
  let updatedCount = 0;

  for await (const record of cursor) {
    const normalized = normalizeCreditReason(record.reason || '');
    const update: any = {};
    if (!record.reasonCode) {
      if (normalized.reasonCode) {
        update.reasonCode = normalized.reasonCode;
      } else {
        update.reasonCode = record.reason;
      }
    }
    if (!record.reasonText) {
      update.reasonText = normalized.reasonText || record.reason;
    }

    if (Object.keys(update).length > 0) {
      await CreditRecord.updateOne({ _id: record._id }, { $set: update });
      updatedCount += 1;
    }
  }

  console.log(`Credit record migration completed. Updated ${updatedCount} records.`);
  process.exit(0);
}

run().catch((error) => {
  console.error('Credit record migration failed:', error);
  process.exit(1);
});
