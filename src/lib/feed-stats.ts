const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

export type FeedTrendGranularity = 'day' | 'week' | 'month';

export interface FeedTrendInput {
  started_at: string;
  amount_ml: number | null;
}

export interface FeedTrendPoint {
  period_start: string;
  label: string;
  total_ml: number;
  average_daily_ml: number;
  measured_day_count: number;
  feed_count: number;
  measured_count: number;
}

export const TREND_BUCKET_COUNTS: Record<FeedTrendGranularity, number> = {
  day: 90,
  week: 12,
  month: 12,
};

export function getTrendBucketCount(granularity: FeedTrendGranularity): number {
  return TREND_BUCKET_COUNTS[granularity];
}

function localDate(now: Date): Date {
  return new Date(now.getTime() + CHINA_OFFSET_MS);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcStartForLocalDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - CHINA_OFFSET_MS);
}

function businessDate(date: Date): Date {
  const china = localDate(date);
  if (china.getUTCHours() < 8) china.setUTCDate(china.getUTCDate() - 1);
  return china;
}

function weekKey(china: Date): string {
  const day = china.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  china.setUTCDate(china.getUTCDate() + mondayOffset);
  return formatDate(china);
}

function monthKey(china: Date): string {
  return `${china.getUTCFullYear()}-${String(china.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function keyFor(granularity: FeedTrendGranularity, date: Date): string {
  const chinaBusiness = businessDate(date);
  return granularity === 'day'
    ? formatDate(chinaBusiness)
    : granularity === 'week'
      ? weekKey(chinaBusiness)
      : monthKey(chinaBusiness);
}

function shiftKey(granularity: FeedTrendGranularity, key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number);
  if (granularity === 'month') {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  const d = new Date(Date.UTC(year, month - 1, day + delta * (granularity === 'week' ? 7 : 1)));
  return formatDate(d);
}

function periodStart(granularity: FeedTrendGranularity, key: string): Date {
  if (granularity === 'day') {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return utcStartForLocalDate(key);
}

function labelFor(granularity: FeedTrendGranularity, key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  if (granularity === 'month') return `${year}年${month}月`;
  return `${month}月${day}日`;
}

export function getTrendPeriodStart(granularity: FeedTrendGranularity, date: Date): string {
  return periodStart(granularity, keyFor(granularity, date)).toISOString();
}

export function getTrendRangeStart(granularity: FeedTrendGranularity, now = new Date()): string {
  const currentKey = keyFor(granularity, now);
  const startKey = shiftKey(granularity, currentKey, -(getTrendBucketCount(granularity) - 1));
  return periodStart(granularity, startKey).toISOString();
}

export function buildFeedTrend(
  granularity: FeedTrendGranularity,
  now: Date,
  records: FeedTrendInput[],
): FeedTrendPoint[] {
  const count = getTrendBucketCount(granularity);
  const currentKey = keyFor(granularity, now);
  const startKey = shiftKey(granularity, currentKey, -(count - 1));
  const points = new Map<string, FeedTrendPoint>();
  const measuredDaysByPeriod = new Map<string, Set<string>>();

  for (let i = 0; i < count; i += 1) {
    const key = shiftKey(granularity, startKey, i);
    points.set(key, {
      period_start: periodStart(granularity, key).toISOString(),
      label: labelFor(granularity, key),
      total_ml: 0,
      average_daily_ml: 0,
      measured_day_count: 0,
      feed_count: 0,
      measured_count: 0,
    });
  }

  for (const record of records) {
    const started = new Date(record.started_at);
    if (!Number.isFinite(started.getTime())) continue;
    const key = keyFor(granularity, started);
    const point = points.get(key);
    if (!point) continue;
    point.feed_count += 1;
    if (record.amount_ml !== null && Number.isFinite(record.amount_ml)) {
      point.total_ml += record.amount_ml;
      point.measured_count += 1;
      const dayKey = getTrendPeriodStart('day', started);
      const measuredDays = measuredDaysByPeriod.get(key) ?? new Set<string>();
      measuredDays.add(dayKey);
      measuredDaysByPeriod.set(key, measuredDays);
    }
  }

  for (const [key, point] of points) {
    const measuredDayCount = measuredDaysByPeriod.get(key)?.size ?? 0;
    point.measured_day_count = measuredDayCount;
    point.average_daily_ml = measuredDayCount > 0
      ? Math.round((point.total_ml / measuredDayCount) * 10) / 10
      : 0;
  }

  return [...points.values()];
}
