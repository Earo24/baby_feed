import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiRecordTrend } from '../src/lib/multi-record-stats';

const NOW = new Date('2026-08-26T03:00:00.000Z');

test('aggregates feed and all event record types into one daily bucket', () => {
  const points = buildMultiRecordTrend('day', NOW, {
    feeds: [{ started_at: '2026-08-26T02:00:00.000Z', amount_ml: 120 }],
    poops: [{ started_at: '2026-08-26T01:00:00.000Z' }],
    medications: [{ started_at: '2026-08-26T01:30:00.000Z' }],
    solid_foods: [{ started_at: '2026-08-26T02:30:00.000Z' }],
    awakes: [{ started_at: '2026-08-26T00:00:00.000Z', ended_at: '2026-08-26T00:42:00.000Z' }],
  });

  const current = points.at(-1)!;
  assert.equal(current.period_start, '2026-08-26T00:00:00.000Z');
  assert.equal(current.feed_count, 1);
  assert.equal(current.total_ml, 120);
  assert.deepEqual(current.events, {
    poop_count: 1,
    medication_count: 1,
    solid_food_count: 1,
    awake_count: 1,
    awake_minutes: 42,
  });
});

test('excludes active awake, invalid timestamps, and negative awake durations', () => {
  const points = buildMultiRecordTrend('day', NOW, {
    feeds: [],
    poops: [{ started_at: 'not-a-date' }],
    medications: [{ started_at: '2026-08-26T01:00:00.000Z' }],
    solid_foods: [{ started_at: 'invalid' }],
    awakes: [
      { started_at: '2026-08-26T00:00:00.000Z', ended_at: null },
      { started_at: 'bad', ended_at: '2026-08-26T00:30:00.000Z' },
      { started_at: '2026-08-26T00:00:00.000Z', ended_at: 'bad' },
      { started_at: '2026-08-26T01:00:00.000Z', ended_at: '2026-08-26T00:00:00.000Z' },
    ],
  });

  const current = points.at(-1)!;
  assert.equal(current.events.poop_count, 0);
  assert.equal(current.events.medication_count, 1);
  assert.equal(current.events.solid_food_count, 0);
  assert.equal(current.events.awake_count, 0);
  assert.equal(current.events.awake_minutes, 0);
});

test('keeps event-only periods and applies the 08:00 boundary to week and month', () => {
  const weekPoints = buildMultiRecordTrend('week', NOW, {
    feeds: [],
    poops: [
      { started_at: '2026-08-23T23:00:00.000Z' }, // Aug 24 07:00 Beijing -> week of Aug 17
      { started_at: '2026-08-24T00:00:00.000Z' }, // Aug 24 08:00 Beijing -> week of Aug 24
    ],
    medications: [],
    solid_foods: [],
    awakes: [],
  });
  const priorWeek = weekPoints.find((point) => point.period_start === '2026-08-16T16:00:00.000Z')!;
  const currentWeek = weekPoints.find((point) => point.period_start === '2026-08-23T16:00:00.000Z')!;
  assert.equal(priorWeek.events.poop_count, 1);
  assert.equal(currentWeek.events.poop_count, 1);
  assert.equal(priorWeek.feed_count, 0);

  const monthPoints = buildMultiRecordTrend('month', NOW, {
    feeds: [],
    poops: [
      { started_at: '2026-07-31T23:00:00.000Z' }, // Aug 1 07:00 Beijing -> July
      { started_at: '2026-08-01T00:00:00.000Z' }, // Aug 1 08:00 Beijing -> August
    ],
    medications: [],
    solid_foods: [],
    awakes: [],
  });
  const july = monthPoints.find((point) => point.label === '2026年7月')!;
  const august = monthPoints.find((point) => point.label === '2026年8月')!;
  assert.equal(july.events.poop_count, 1);
  assert.equal(august.events.poop_count, 1);
});
