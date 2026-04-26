import dotenv from 'dotenv';
import { connectMongoDB } from '../src/database/mongodb';
import { User, StudentRegistry } from '../src/models/mongodb';

dotenv.config();

function hasArg(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

async function run() {
    const execute = hasArg('execute');
    const dryRun = !execute;

    await connectMongoDB();

    const users = await User.find({
        studentId: { $exists: true, $ne: '' },
        name: { $exists: true, $ne: '' },
    })
        .select('studentId name')
        .lean();

    let planned = 0;
    let inserted = 0;
    let skipped = 0;

    for (const item of users as any[]) {
        const studentId = String(item.studentId ?? '').trim();
        const realName = String(item.name ?? '').trim();

        if (!/^\d{11}$/.test(studentId) || !realName) {
            skipped += 1;
            continue;
        }

        const existed = await StudentRegistry.findOne({ studentId })
            .select('_id')
            .lean();

        if (existed) {
            skipped += 1;
            continue;
        }

        planned += 1;

        if (!dryRun) {
            await StudentRegistry.create({
                studentId,
                realName,
                active: true,
            });
            inserted += 1;
        }
    }

    console.log('[seed-student-registry] done', {
        mode: dryRun ? 'dry-run' : 'execute',
        sourceUsers: users.length,
        planned,
        inserted,
        skipped,
    });

    process.exit(0);
}

run().catch((error) => {
    console.error('[seed-student-registry] failed:', error?.stack || error);
    process.exit(1);
});