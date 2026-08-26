import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
const trendSource = readFileSync(new URL('../src/components/feed-volume-trend.tsx', import.meta.url), 'utf8');

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

test('shows a history load error instead of rendering the previous range snapshot', () => {
  const loadingBranch = pageSource.indexOf('{historyLoading ?');
  const errorBranch = pageSource.indexOf(': historyError ?');
  const emptyBranch = pageSource.indexOf('historyFeeds.length === 0');

  assert.ok(loadingBranch >= 0);
  assert.ok(errorBranch > loadingBranch);
  assert.ok(emptyBranch > errorBranch);
  assert.match(pageSource, /role="alert"/);
  assert.match(pageSource, /加载失败，请重试/);
});

test('refreshes after deletion from the context current when deletion finishes', () => {
  const handlerStart = pageSource.indexOf('const handleDeleteSolidFood');
  const handlerEnd = pageSource.indexOf('const handleQuickAddPoop', handlerStart);
  const handlerSource = pageSource.slice(handlerStart, handlerEnd);

  assert.match(handlerSource, /requestState\.getRefreshContext\(\)/);
  assert.match(handlerSource, /loadHistorySnapshot\(context\.roomId, context\.days\)/);
  assert.doesNotMatch(handlerSource, /(?<!\.)\bshowHistory\b/);
  assert.doesNotMatch(handlerSource, /(?<!\.)\bhistoryDays\b/);
});

test('feed volume trend component exposes the three granularity controls and stats request contract', () => {
  assert.match(trendSource, /按天/);
  assert.match(trendSource, /按周/);
  assert.match(trendSource, /按月/);
  assert.match(trendSource, /feed-stats\?granularity=/);
  assert.match(trendSource, /aria-pressed/);
});

test('renders feed volume trend inside the guarded history overlay', () => {
  assert.match(pageSource, /import\s+\{?\s*FeedVolumeTrend\s*\}?\s+from\s+['"]@\/components\/feed-volume-trend['"]/);
  assert.match(pageSource, /<FeedVolumeTrend\s+roomId=\{room\.id\}\s+todayTotalMl=\{todayTotalMl\}\s+refreshKey=\{feedTrendRefreshKey\}\s*\/>/);
});
