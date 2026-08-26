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

test('samples long trend axis labels without dropping trend data points', () => {
  assert.match(trendSource, /granularity === 'day' && pointCount > 30/);
  assert.match(trendSource, /\(granularity === 'week' \|\| granularity === 'month'\) && pointCount > 6/);
  assert.match(trendSource, /index % 2 === 0 \|\| index === pointCount - 1/);
  assert.match(trendSource, /<BarChart data=\{points\}/);
});

test('renders feed volume trend inside the guarded history overlay', () => {
  assert.match(pageSource, /import\s+\{?\s*FeedVolumeTrend\s*\}?\s+from\s+['"]@\/components\/feed-volume-trend['"]/);
  assert.match(pageSource, /<FeedVolumeTrend\s+roomId=\{room\.id\}\s+todayTotalMl=\{todayTotalMl\}\s+refreshKey=\{feedTrendRefreshKey\}\s*\/>/);
});

test('refreshes feed volume trend after feed mutations', () => {
  assert.match(pageSource, /const \[feedTrendRefreshNonce, setFeedTrendRefreshNonce\] = useState\(0\)/);
  assert.match(pageSource, /const feedTrendRefreshKey = `\$\{feedTrendRefreshNonce\}:/);

  const addHandlerStart = pageSource.indexOf('const handleConfirm = async');
  const addHandlerEnd = pageSource.indexOf('const handleSkipConfirm', addHandlerStart);
  const deleteHandlerStart = pageSource.indexOf('const handleDeleteFeed = async');
  const deleteHandlerEnd = pageSource.indexOf('const handleQuickAddSolidFood', deleteHandlerStart);
  assert.match(pageSource.slice(addHandlerStart, addHandlerEnd), /setFeedTrendRefreshNonce\(\(value\) => value \+ 1\)/);
  assert.match(pageSource.slice(deleteHandlerStart, deleteHandlerEnd), /setFeedTrendRefreshNonce\(\(value\) => value \+ 1\)/);
});
