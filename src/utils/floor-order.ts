function extractFloorRank(name?: string | null) {
    const raw = String(name || '').trim();
    const match = raw.match(/-?\d+(\.\d+)?/);

    if (match) {
        return Number(match[0]);
    }

    const zhMap: Record<string, number> = {
        地下: -1,
        负一: -1,
        负二: -2,
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
        十: 10,
    };

    for (const [key, value] of Object.entries(zhMap)) {
        if (raw.includes(key)) {
            return value;
        }
    }

    return Number.POSITIVE_INFINITY;
}

export function compareFloorName(a?: string | null, b?: string | null) {
    const rankA = extractFloorRank(a);
    const rankB = extractFloorRank(b);

    if (rankA !== rankB) {
        return rankA - rankB;
    }

    return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', {
        numeric: true,
        sensitivity: 'base',
    });
}
