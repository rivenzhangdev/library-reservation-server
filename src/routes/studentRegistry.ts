import Router from 'koa-router';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { CustomError } from '../middleware/error';
import { StudentRegistry } from '../models/mongodb';
import { ErrorCodes } from '../utils/error-codes';
import { formatRouteDateTimes } from '../utils/route-time-serializer';

const router = new Router({ prefix: '/api/student-registry' });

/**
 * @route GET /api/student-registry
 * @desc List student registry entries (admin only)
 */
router.get('/', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const {
            page = '1',
            pageSize = '20',
            studentId,
            realName,
            college,
            major,
            grade,
            active,
        } = ctx.query as Record<string, string>;

        const query: Record<string, any> = {};
        if (studentId)
            query.studentId = {
                $regex: String(studentId).trim(),
                $options: 'i',
            };
        if (realName)
            query.realName = { $regex: String(realName).trim(), $options: 'i' };
        if (college)
            query.college = { $regex: String(college).trim(), $options: 'i' };
        if (major)
            query.major = { $regex: String(major).trim(), $options: 'i' };
        if (grade)
            query.grade = { $regex: String(grade).trim(), $options: 'i' };
        if (active !== undefined && active !== '') {
            query.active = active === 'true' || active === '1';
        }

        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const normalizedPageSize = Math.min(
            Math.max(parseInt(pageSize, 10) || 20, 1),
            200
        );

        const [total, records] = await Promise.all([
            StudentRegistry.countDocuments(query),
            StudentRegistry.find(query)
                .sort({ createdAt: -1 })
                .skip((pageNum - 1) * normalizedPageSize)
                .limit(normalizedPageSize)
                .lean(),
        ]);

        ctx.body = {
            success: true,
            data: {
                list: records.map((r: any) =>
                    formatRouteDateTimes({ ...r, id: r._id })
                ),
                total,
                page: pageNum,
                pageSize: normalizedPageSize,
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('List student registry failed', error);
        throw new CustomError(
            'Failed to list student registry',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route POST /api/student-registry
 * @desc Create a single registry entry (admin only)
 */
router.post('/', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { studentId, realName, college, major, grade, active } =
            (ctx.request.body as any) ?? {};

        const normalizedStudentId = String(studentId ?? '').trim();
        const normalizedRealName = String(realName ?? '').trim();

        if (!normalizedStudentId || !normalizedRealName) {
            throw new CustomError(
                'studentId and realName are required',
                ErrorCodes.INVALID_PARAMS
            );
        }
        if (!/^\d{11}$/.test(normalizedStudentId)) {
            throw new CustomError(
                'Invalid student ID format (must be 11 digits)',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const exists = await StudentRegistry.findOne({
            studentId: normalizedStudentId,
        });
        if (exists) {
            throw new CustomError(
                'Student ID already exists in registry',
                ErrorCodes.STUDENT_ID_EXISTS
            );
        }

        const record = await StudentRegistry.create({
            studentId: normalizedStudentId,
            realName: normalizedRealName,
            college: String(college ?? '').trim() || undefined,
            major: String(major ?? '').trim() || undefined,
            grade: String(grade ?? '').trim() || undefined,
            active: active !== false && active !== 'false',
        });

        ctx.body = {
            success: true,
            data: { id: record._id, ...record.toObject() },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Create student registry entry failed', error);
        throw new CustomError(
            'Failed to create student registry entry',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route PUT /api/student-registry/:id
 * @desc Update a registry entry (admin only)
 */
router.put('/:id', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { id } = ctx.params;
        const { realName, college, major, grade, active } =
            (ctx.request.body as any) ?? {};

        const record = await StudentRegistry.findById(id);
        if (!record) {
            throw new CustomError('Record not found', ErrorCodes.NOT_FOUND);
        }

        if (realName !== undefined) record.realName = String(realName).trim();
        if (college !== undefined)
            record.college = String(college).trim() || undefined;
        if (major !== undefined)
            record.major = String(major).trim() || undefined;
        if (grade !== undefined)
            record.grade = String(grade).trim() || undefined;
        if (active !== undefined)
            record.active = active === true || active === 'true';

        await record.save();
        ctx.body = {
            success: true,
            data: { id: record._id, ...record.toObject() },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Update student registry entry failed', error);
        throw new CustomError(
            'Failed to update student registry entry',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route DELETE /api/student-registry/:id
 * @desc Delete a registry entry (admin only)
 */
router.delete('/:id', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { id } = ctx.params;
        const record = await StudentRegistry.findByIdAndDelete(id);
        if (!record) {
            throw new CustomError('Record not found', ErrorCodes.NOT_FOUND);
        }
        ctx.body = { success: true };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Delete student registry entry failed', error);
        throw new CustomError(
            'Failed to delete student registry entry',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route POST /api/student-registry/import
 * @desc Batch import registry entries from JSON array (admin only)
 * Body: { records: Array<{ studentId, realName, college?, major?, grade? }> }
 */
router.post('/import', authMiddleware, adminMiddleware, async (ctx) => {
    try {
        const { records } = (ctx.request.body as any) ?? {};

        if (!Array.isArray(records) || records.length === 0) {
            throw new CustomError(
                'records array is required and must not be empty',
                ErrorCodes.INVALID_PARAMS
            );
        }
        if (records.length > 5000) {
            throw new CustomError(
                'Max 5000 records per import batch',
                ErrorCodes.INVALID_PARAMS
            );
        }

        const errors: string[] = [];
        const toUpsert: Array<{
            studentId: string;
            realName: string;
            college?: string;
            major?: string;
            grade?: string;
        }> = [];

        for (let i = 0; i < records.length; i++) {
            const row = records[i];
            const sid = String(row.studentId ?? '').trim();
            const name = String(row.realName ?? '').trim();
            if (!sid || !name) {
                errors.push(
                    `Row ${i + 1}: studentId and realName are required`
                );
                continue;
            }
            if (!/^\d{11}$/.test(sid)) {
                errors.push(`Row ${i + 1}: invalid studentId format "${sid}"`);
                continue;
            }
            toUpsert.push({
                studentId: sid,
                realName: name,
                college: String(row.college ?? '').trim() || undefined,
                major: String(row.major ?? '').trim() || undefined,
                grade: String(row.grade ?? '').trim() || undefined,
            });
        }

        if (errors.length > 0 && toUpsert.length === 0) {
            throw new CustomError(
                `All rows have errors: ${errors.slice(0, 5).join('; ')}`,
                ErrorCodes.INVALID_PARAMS
            );
        }

        let inserted = 0;
        let updated = 0;

        const uniqueStudentIds = Array.from(
            new Set(toUpsert.map((item) => item.studentId))
        );
        const existingRecords = await StudentRegistry.find(
            { studentId: { $in: uniqueStudentIds } },
            { studentId: 1 }
        ).lean();
        const existingStudentIds = new Set(
            existingRecords.map((item: any) => String(item.studentId))
        );

        for (const item of toUpsert) {
            const existedBeforeImport = existingStudentIds.has(item.studentId);

            await StudentRegistry.updateOne(
                { studentId: item.studentId },
                {
                    $set: {
                        realName: item.realName,
                        ...(item.college !== undefined
                            ? { college: item.college }
                            : {}),
                        ...(item.major !== undefined
                            ? { major: item.major }
                            : {}),
                        ...(item.grade !== undefined
                            ? { grade: item.grade }
                            : {}),
                        active: true,
                    },
                    $setOnInsert: {
                        studentId: item.studentId,
                    },
                },
                { upsert: true }
            );

            if (existedBeforeImport) {
                updated++;
            } else {
                inserted++;
                existingStudentIds.add(item.studentId);
            }
        }

        ctx.body = {
            success: true,
            data: {
                total: records.length,
                inserted,
                updated,
                skipped: records.length - toUpsert.length,
                errors: errors.slice(0, 20),
            },
        };
    } catch (error: any) {
        if (error.isCustom) throw error;
        console.error('Import student registry failed', error);
        throw new CustomError(
            'Failed to import student registry',
            ErrorCodes.INTERNAL_ERROR
        );
    }
});

/**
 * @route GET /api/student-registry/template
 * @desc Download CSV template for batch import
 */
router.get('/template', authMiddleware, adminMiddleware, async (ctx) => {
    const csvContent =
        'studentId,realName,college,major,grade\n20210001234,张三,计算机学院,软件工程,2021级\n20210001235,李四,经济管理学院,工商管理,2021级\n';
    ctx.set('Content-Type', 'text/csv; charset=utf-8');
    ctx.set(
        'Content-Disposition',
        'attachment; filename="student-registry-template.csv"'
    );
    ctx.body = '\uFEFF' + csvContent; // BOM for Excel compatibility
});

export default router;
