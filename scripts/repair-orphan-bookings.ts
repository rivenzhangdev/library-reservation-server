import dotenv from 'dotenv';
import { connectMongoDB } from '../src/database/mongodb';
import { testConnection } from '../src/database/mysql';
import { repairOrphanActiveBookings } from '../src/services/orphan-booking-service';

dotenv.config();

function hasArg(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

async function run() {
    const execute = hasArg('execute');

    await Promise.all([testConnection(), connectMongoDB()]);

    const result = await repairOrphanActiveBookings({ execute });
    console.log('[repair-orphan-bookings] done', result);
    process.exit(0);
}

run().catch((error) => {
    console.error('[repair-orphan-bookings] failed:', error?.stack || error);
    process.exit(1);
});