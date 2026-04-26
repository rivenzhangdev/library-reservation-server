import { Op, Transaction } from 'sequelize';
import sequelize from '../database/mysql';
import { Booking, TimeSlotStatus } from '../models/mysql';
import { User } from '../models/mongodb';
import { BookingStatus, TimeSlotStatusValue } from '../models/mysql/types';

export type OrphanBookingRecord = {
    id: number;
    userId: string;
    seatId: number;
    date: string;
    timeSlot: number;
    startTime?: string;
    endTime?: string;
    status: number;
};

export type OrphanBookingRepairResult = {
    scanned: number;
    orphanCount: number;
    repairedCount: number;
    orphanBookingIds: number[];
    orphanBookings: OrphanBookingRecord[];
    mode: 'dry-run' | 'execute';
};

function normalizeTimePart(value: any): string | undefined {
    const raw = String(value ?? '').trim();
    if (!raw) return undefined;
    if (raw.includes('T')) {
        return raw.split('T')[1]?.slice(0, 8) || undefined;
    }
    if (raw.includes(' ')) {
        return raw.split(' ')[1]?.slice(0, 8) || undefined;
    }
    return raw.slice(0, 8);
}

export async function findOrphanActiveBookings(): Promise<
    OrphanBookingRecord[]
> {
    const activeBookings = await Booking.findAll({
        where: {
            status: {
                [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
            },
        },
        attributes: [
            'id',
            'userId',
            'seatId',
            'date',
            'timeSlot',
            'startTime',
            'endTime',
            'status',
        ],
    });

    const userIds = Array.from(
        new Set(
            activeBookings
                .map((item: any) => String(item.userId || '').trim())
                .filter(Boolean)
        )
    );

    const existingUsers = userIds.length
        ? await User.find({ _id: { $in: userIds } })
              .select('_id')
              .lean()
        : [];
    const existingUserIdSet = new Set(
        existingUsers.map((item: any) => String(item._id))
    );

    return activeBookings
        .filter(
            (item: any) =>
                !existingUserIdSet.has(String(item.userId || '').trim())
        )
        .map((item: any) => ({
            id: Number(item.id),
            userId: String(item.userId || ''),
            seatId: Number(item.seatId || 0),
            date: String(item.date || ''),
            timeSlot: Number(item.timeSlot || 0),
            startTime: normalizeTimePart(item.startTime),
            endTime: normalizeTimePart(item.endTime),
            status: Number(item.status),
        }));
}

export async function repairOrphanActiveBookings(
    options: {
        execute?: boolean;
        operatorId?: string;
    } = {}
): Promise<OrphanBookingRepairResult> {
    const activeBookings = await Booking.count({
        where: {
            status: {
                [Op.in]: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
            },
        },
    });
    const orphanBookings = await findOrphanActiveBookings();
    const orphanBookingIds = orphanBookings.map((item) => item.id);
    const execute = options.execute === true;

    if (execute && orphanBookingIds.length > 0) {
        await sequelize.transaction(async (t: Transaction) => {
            await Booking.update(
                {
                    status: BookingStatus.CANCELED,
                    ...(options.operatorId
                        ? { updatedBy: options.operatorId }
                        : {}),
                },
                {
                    where: { id: orphanBookingIds },
                    transaction: t,
                }
            );

            await TimeSlotStatus.update(
                {
                    status: TimeSlotStatusValue.AVAILABLE,
                    bookingId: undefined,
                },
                {
                    where: { bookingId: orphanBookingIds },
                    transaction: t,
                }
            );
        });
    }

    return {
        scanned: activeBookings,
        orphanCount: orphanBookings.length,
        repairedCount: execute ? orphanBookings.length : 0,
        orphanBookingIds,
        orphanBookings,
        mode: execute ? 'execute' : 'dry-run',
    };
}
