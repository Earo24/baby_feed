import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TREND_BUCKET_COUNTS,
  buildFeedTrend,
  getTrendBucketCount,
  getTrendRangeStart,
} from '../src/lib/feed-stats';

const NOW = new Date('2026-08-26T03:00:00.000Z'); // 北京 11:00, bucket 2026-08-26

test('trend bucket counts and range starts are stable', () => {
  assert.deepEqual(TREND_BUCKET_COUNTS, { day: 90, week: 12, month: 12 });
  assert.equal(getTrendBucketCount('day'), 90);
  assert.equal(getTrendBucketCount('week'), 12);
  assert.equal(getTrendBucketCount('month'), 12);
  assert.equal(getTrendRangeStart('day', NOW), '2026-05-29T00:00:00.000Z');
  assert.equal(getTrendRangeStart('week', NOW), '2026-06-07T16:00:00.000Z');
  assert.equal(getTrendRangeStart('month', NOW), '2025-08-31T16:00:00.000Z');
});

test('day trend uses Beijing 08:00 boundary and counts measured values', () => {
  const points = buildFeedTrend('day', NOW, [
    { started_at: '2026-08-25T23:59:59.999Z', amount_ml: 100 }, // Beijing 07:59, previous day
    { started_at: '2026-08-26T00:00:00.000Z', amount_ml: null }, // Beijing 08:00, current day
    { started_at: '2026-08-26T01:00:00.000Z', amount_ml: Number.NaN },
    { started_at: '2026-08-26T02:00:00.000Z', amount_ml: 80 },
  ]);
  const current = points.at(-1)!;
  assert.equal(current.period_start, '2026-08-26T00:00:00.000Z');
  assert.equal(current.label, '8月26日');
  assert.equal(current.feed_count, 3);
  assert.equal(current.measured_count, 1);
  assert.equal(current.total_ml, 80);
});

test('week trend aggregates by Beijing Monday and returns continuous buckets', () => {
  const points = buildFeedTrend('week', NOW, [
    { started_at: '2026-08-24T00:00:00.000Z', amount_ml: 120 }, // Monday Beijing
    { started_at: '2026-08-30T15:59:59.000Z', amount_ml: 30 }, // Sunday 23:59 Beijing
    { started_at: '2026-08-30T16:00:00.000Z', amount_ml: 50 }, // Monday 00:00 Beijing
  ]);
  assert.equal(points.length, 12);
  const weekOfAug24 = points.find((point) => point.period_start === '2026-08-23T16:00:00.000Z')!;
  assert.equal(weekOfAug24.label, '8月24日');
  assert.equal(weekOfAug24.total_ml, 150);
  assert.ok(points.every((point) => point.period_start && point.label));
});

test('month trend handles Beijing month boundary', () => {
  const points = buildFeedTrend('month', NOW, [
    { started_at: '2026-07-31T15:59:59.000Z', amount_ml: 40 }, // Aug 31 23:59 Beijing
    { started_at: '2026-07-31T16:00:00.000Z', amount_ml: 60 }, // Sep 1 Beijing
    { started_at: '2026-08-25T00:00:00.000Z', amount_ml: 20 },
  ]);
  assert.equal(points.find((point) => point.label === '2026年7月')!.total_ml, 40);
  assert.equal(points.find((point) => point.label === '2026年8月')!.total_ml, 80);
});
