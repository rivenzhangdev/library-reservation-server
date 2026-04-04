import { Floor, Seat, Booking, TimeSlotStatus } from './index';
import { Zone } from './index';

/**
 * 配置 MySQL 模型之间的关系
 */
export function setupMySQLModelRelations() {
    // Floor 和 Seat 的关系：一对多
    Floor.hasMany(Seat, { foreignKey: 'floorId', as: 'seats' });
    Seat.belongsTo(Floor, { foreignKey: 'floorId', as: 'floor' });

    // Seat 和 Booking 的关系：一对多
    Seat.hasMany(Booking, { foreignKey: 'seatId', as: 'bookings' });
    Booking.belongsTo(Seat, { foreignKey: 'seatId', as: 'seat' });

    // Zone 与 Seat 的关系暂不启用 (数据库尚无 zones 表和 zone_id 列)
    // Zone.hasMany(Seat, { foreignKey: 'zoneId', as: 'seats' });
    // Seat.belongsTo(Zone, { foreignKey: 'zoneId', as: 'zoneObj' });

    // Booking 和 TimeSlotStatus 的关系：一对一
    Booking.hasOne(TimeSlotStatus, {
        foreignKey: 'bookingId',
        as: 'timeSlotStatus',
    });
    TimeSlotStatus.belongsTo(Booking, {
        foreignKey: 'bookingId',
        as: 'booking',
    });

    console.log('MySQL 模型关系配置完成');
}
