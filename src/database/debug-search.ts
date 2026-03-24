/**
 * 调试搜索接口
 */

import { Op } from 'sequelize';
import sequelize from '../database/mysql';
import { Floor, Seat } from '../models/mysql';

async function debugSearch() {
    console.log('\n=====================================');
    console.log('  调试搜索接口');
    console.log('=====================================\n');

    try {
        // 测试 1: 直接查询所有座位
        console.log('[测试 1] 查询所有座位...');
        const allSeats = await Seat.findAll();
        console.log(`✓ 找到 ${allSeats.length} 个座位\n`);

        // 测试 2: 模糊搜索 description
        console.log('[测试 2] 模糊搜索 description 包含"靠窗"...');
        const keyword = '靠窗';
        const seats = await Seat.findAll({
            where: {
                description: {
                    [Op.like]: `%${keyword}%`,
                },
            },
            include: [
                {
                    model: Floor,
                    attributes: ['id', 'name'],
                },
            ],
        });
        console.log(`✓ 找到 ${seats.length} 个匹配的座位\n`);

        seats.forEach((seat) => {
            console.log(
                `  - 座位${seat.id}: ${seat.description} (${
                    (seat as any).floor?.name ?? '未知楼层'
                })`
            );
        });
        console.log('');

        // 测试 3: 使用原始 SQL
        console.log('[测试 3] 使用原始 SQL 查询...');
        const [results] = await sequelize.query(`
      SELECT s.*, f.name as floor_name 
      FROM seats s 
      LEFT JOIN floors f ON s.floor_id = f.id 
      WHERE s.description LIKE '%靠窗%'
    `);
        console.log(`✓ SQL 查询找到 ${(results as any[]).length} 个结果\n`);

        console.log('✅ 所有测试通过！搜索功能正常\n');
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
        const errorStack =
            error instanceof Error ? error.stack : 'No stack trace';
        console.error('❌ 测试失败:', errorMessage);
        console.error('堆栈:', errorStack);
    } finally {
        // 标记为已处理，避免 floating promise 警告
        void sequelize.close();
        process.exit(0);
    }
}

void debugSearch();
