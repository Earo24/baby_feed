import {
  buildFeedTrend,
  getTrendPeriodStart,
  type FeedTrendGranularity,
  type FeedTrendInput,
  type FeedTrendPoint,
} from './feed-stats';

export type TrendTimedRecord = { started_at: string };
export type TrendAwakeRecord = { started_at: string; ended_at: string | null };

export type TrendEventCounts = {
  poop_count: number;
  medication_count: number;
  solid_food_count: number;
  awake_count: number;
  awake_minutes: number;
};

export type MultiTrendRecords = {
  feeds: FeedTrendInput[];
  poops: TrendTimedRecord[];
  medications: TrendTimedRecord[];
  solid_foods: TrendTimedRecord[];
  awakes: TrendAwakeRecord[];
};

export type MultiTrendPoint = FeedTrendPoint & { events: TrendEventCounts };

function emptyEvents(): TrendEventCounts {
  return {
    poop_count: 0,
    medication_count: 0,
    solid_food_count: 0,
    awake_count: 0,
    awake_minutes: 0,
  };
}

export function buildMultiRecordTrend(
  granularity: FeedTrendGranularity,
  now: Date,
  records: MultiTrendRecords,
): MultiTrendPoint[] {
  const basePoints = buildFeedTrend(granularity, now, records.feeds);
  const points = basePoints.map((point) => ({ ...point, events: emptyEvents() }));
  const byPeriod = new Map(points.map((point) => [point.period_start, point]));

  const addTimedEvents = (items: TrendTimedRecord[], field: 'poop_count' | 'medication_count' | 'solid_food_count') => {
    for (const item of items) {
      const started = new Date(item.started_at);
      if (!Number.isFinite(started.getTime())) continue;
      const point = byPeriod.get(getTrendPeriodStart(granularity, started));
      if (point) point.events[field] += 1;
    }
  };

  addTimedEvents(records.poops, 'poop_count');
  addTimedEvents(records.medications, 'medication_count');
  addTimedEvents(records.solid_foods, 'solid_food_count');

  for (const awake of records.awakes) {
    if (awake.ended_at === null) continue;
    const started = new Date(awake.started_at);
    const ended = new Date(awake.ended_at);
    if (!Number.isFinite(started.getTime()) || !Number.isFinite(ended.getTime())) continue;
    const durationMs = ended.getTime() - started.getTime();
    if (durationMs < 0) continue;
    const point = byPeriod.get(getTrendPeriodStart(granularity, started));
    if (!point) continue;
    point.events.awake_count += 1;
    point.events.awake_minutes += Math.round(durationMs / 60000);
  }

  return points;
}
