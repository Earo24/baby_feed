import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');

test('guards room refresh commits with the latest-request gate', () => {
  assert.match(pageSource, /requestState\.roomGate\.begin\(roomId\)/);
  assert.match(pageSource, /requestState\.roomGate\.isLatest\(requestToken\)/);
  assert.match(pageSource, /requestState\.roomGate\.invalidate\(\)/);
});

test('uses one guarded five-type history snapshot loader for opening, range changes, and deletion', () => {
  assert.match(pageSource, /fetchHistorySnapshot</);
  assert.match(pageSource, /requestState\.historyGate\.begin/);
  assert.match(pageSource, /loadHistorySnapshot\(room\.id, historyDays\)/);
  assert.match(pageSource, /loadHistorySnapshot\(room\.id, days\)/);
  assert.doesNotMatch(pageSource, /loadSolidFoodHistory/);
});
