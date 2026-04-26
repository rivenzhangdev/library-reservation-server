import axios from 'axios';

interface PerfResult {
  ok: boolean;
  status?: number;
  code?: string;
  durationMs: number;
  error?: string;
}

function getArgValue(name: string): string | undefined {
  const prefixed = `--${name}=`;
  const matched = process.argv.find((arg) => arg.startsWith(prefixed));
  if (matched) {
    return matched.slice(prefixed.length).trim();
  }

  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    const value = String(process.argv[idx + 1] || '').trim();
    if (value && !value.startsWith('--')) {
      return value;
    }
  }

  return undefined;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function run() {
  const baseUrl = getArgValue('base-url') || process.env.BENCHMARK_BASE_URL || 'http://127.0.0.1:3000';
  const token = getArgValue('token') || process.env.BENCHMARK_TOKEN || '';
  const seatId = Number(getArgValue('seat-id') || process.env.BENCHMARK_SEAT_ID || 0);
  const date = getArgValue('date') || process.env.BENCHMARK_DATE || '';
  const timeSlot = Number(getArgValue('time-slot') || process.env.BENCHMARK_TIME_SLOT || 0);
  const concurrency = Math.max(1, Number(getArgValue('concurrency') || process.env.BENCHMARK_CONCURRENCY || 20));

  if (!token || !seatId || !date || !Number.isFinite(timeSlot)) {
    throw new Error(
      'Missing required args. Need token, seat-id, date, time-slot. Example: pnpm -s ts-node scripts/benchmark-booking-conflict.ts --token=xxx --seat-id=1 --date=2026-04-22 --time-slot=2'
    );
  }

  console.log('[info] booking conflict benchmark');
  console.log('[info] target:', {
    baseUrl,
    seatId,
    date,
    timeSlot,
    concurrency,
  });

  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/booking`;

  const tasks = Array.from({ length: concurrency }).map(async (_, index) => {
    const start = Date.now();
    try {
      const response = await axios.post(
        endpoint,
        { seatId, date, timeSlot },
        {
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Benchmark-Request': `conflict-${index}`,
          },
          validateStatus: () => true,
        }
      );

      const durationMs = Date.now() - start;
      const payload: any = response.data || {};
      const httpOk = response.status >= 200 && response.status < 300;
      const businessOk = payload.success !== false && !payload.error;
      const ok = httpOk && businessOk;
      return {
        ok,
        status: response.status,
        code: String(payload?.error?.code || '').trim() || undefined,
        durationMs,
        error: payload?.error?.message,
      } as PerfResult;
    } catch (error: any) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        error: String(error?.message || error),
      } as PerfResult;
    }
  });

  const results = await Promise.all(tasks);
  const durations = results.map((item) => item.durationMs);

  const successCount = results.filter((item) => item.ok).length;
  const conflictCount = results.filter(
    (item) => item.code === 'BOOKING_CONFLICT' || item.code === '5001' || item.status === 409
  ).length;
  const failedCount = results.length - successCount;

  const summary = {
    total: results.length,
    successCount,
    failedCount,
    conflictCount,
    successRate: Number(((successCount / results.length) * 100).toFixed(2)),
    conflictRate: Number(((conflictCount / results.length) * 100).toFixed(2)),
    tp95Ms: percentile(durations, 95),
    tp99Ms: percentile(durations, 99),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
  };

  console.log('[result] summary:', summary);

  const codeDistribution = results.reduce((acc, item) => {
    const key = String(item.code || (item.ok ? 'SUCCESS' : 'UNKNOWN'));
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('[result] code distribution:', codeDistribution);

  const unexpected = results.filter(
    (item) =>
      !item.ok &&
      item.code !== 'BOOKING_CONFLICT' &&
      item.code !== '5001' &&
      item.status !== 409
  );
  if (unexpected.length > 0) {
    console.log('[warn] unexpected failures (first 5):', unexpected.slice(0, 5));
  }
}

run().catch((error) => {
  console.error('[error] benchmark failed:', error?.stack || error);
  process.exit(1);
});
