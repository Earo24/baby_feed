import assert from 'node:assert/strict';
import test from 'node:test';
import { getChinaCycleStart } from '../src/storage/database/time';

test('starts the China record cycle at 08:00 Beijing time', () => {
  const cases = [
    ['2026-08-25T05:59:00+08:00', '2026-08-24T00:00:00.000Z'],
    ['2026-08-25T06:00:00+08:00', '2026-08-24T00:00:00.000Z'],
    ['2026-08-25T07:59:59+08:00', '2026-08-24T00:00:00.000Z'],
    ['2026-08-25T08:00:00+08:00', '2026-08-25T00:00:00.000Z'],
  ] as const;

  for (const [now, expected] of cases) {
    assert.equal(getChinaCycleStart(1, new Date(now)), expected, now);
  }
});

test('expands day ranges from the current 08:00 China cycle', () => {
  const now = new Date('2026-08-25T12:00:00+08:00');

  assert.equal(getChinaCycleStart(1, now), '2026-08-25T00:00:00.000Z');
  assert.equal(getChinaCycleStart(7, now), '2026-08-19T00:00:00.000Z');
  assert.equal(getChinaCycleStart(14, now), '2026-08-12T00:00:00.000Z');
  assert.equal(getChinaCycleStart(30, now), '2026-07-27T00:00:00.000Z');
  assert.equal(getChinaCycleStart(0, now), '2026-08-25T00:00:00.000Z');
  assert.equal(getChinaCycleStart(31, now), '2026-07-27T00:00:00.000Z');
});
