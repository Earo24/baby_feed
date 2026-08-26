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
  assert.match(trendSource, /granularity === 'month' && pointCount > 6/);
  assert.match(trendSource, /granularity === 'week' && pointCount > 6/);
  assert.match(trendSource, /index % 3 === 0 \|\| index === pointCount - 1/);
  assert.match(trendSource, /index % 2 === 0 \|\| index === pointCount - 1/);
  assert.match(trendSource, /index % 20 === 0 && index !== lastRegularLabelIndex/);
  assert.doesNotMatch(trendSource, /index % 10 === 0 \|\| index === pointCount - 1/);
  assert.match(trendSource, /lastRegularLabelIndex = Math\.floor\(lastIndex \/ 20\) \* 20/);
  assert.match(trendSource, /index !== lastRegularLabelIndex/);
  assert.match(trendSource, /<BarChart data=\{points\}/);
});

test('renders feed volume trend inside the guarded history overlay', () => {
  assert.match(pageSource, /import\s+\{?\s*FeedVolumeTrend\s*\}?\s+from\s+['"]@\/components\/feed-volume-trend['"]/);
  assert.match(pageSource, /<FeedVolumeTrend\s+roomId=\{room\.id\}\s+todayTotalMl=\{todayTotalMl\}\s+refreshKey=\{feedTrendRefreshKey\}\s*\/>/);
});

test('refreshes feed volume trend after feed mutations', () => {
  assert.match(pageSource, /const \[feedTrendRefreshNonce, setFeedTrendRefreshNonce\] = useState\(0\)/);
  assert.match(pageSource, /const feedTrendRefreshKey = `\$\{feedTrendRefreshNonce\}:/);

  const mutationHandlers = [
    ['handleConfirm', 'const handleSkipConfirm'],
    ['handleDeleteFeed', 'const handleQuickAddSolidFood'],
    ['handleSubmitSolidFood', 'const loadHistorySnapshot'],
    ['handleDeleteSolidFood', 'const handleQuickAddPoop'],
    ['handleConfirmPoop', 'const handleDeletePoop'],
    ['handleDeletePoop', '// Medication handlers'],
    ['handleConfirmMed', 'const handleDeleteMed'],
    ['handleDeleteMed', '// Awake handlers'],
    ['handleQuickAddAwake', 'const handleEndAwake'],
    ['handleConfirmAwake', 'const handleDeleteAwake'],
    ['handleDeleteAwake', 'const handleLeaveRoom'],
  ] as const;

  for (const [handlerName, nextDeclaration] of mutationHandlers) {
    const handlerStart = pageSource.indexOf(`const ${handlerName} = async`);
    const handlerEnd = pageSource.indexOf(nextDeclaration, handlerStart);
    assert.ok(handlerStart >= 0, `missing ${handlerName}`);
    assert.ok(handlerEnd > handlerStart, `could not slice ${handlerName}`);
    assert.match(
      pageSource.slice(handlerStart, handlerEnd),
      /setFeedTrendRefreshNonce\(\(value\) => value \+ 1\)/,
      `${handlerName} should refresh the feed volume trend after a successful mutation`,
    );
  }
});

test('requires HTTP success before refreshing feed and closing medication confirmation', () => {
  const handlerSource = (handlerName: string, nextDeclaration: string) => {
    const handlerStart = pageSource.indexOf(`const ${handlerName} = async`);
    const handlerEnd = pageSource.indexOf(nextDeclaration, handlerStart);
    assert.ok(handlerStart >= 0, `missing ${handlerName}`);
    assert.ok(handlerEnd > handlerStart, `could not slice ${handlerName}`);
    return pageSource.slice(handlerStart, handlerEnd);
  };

  for (const [handlerName, nextDeclaration] of [
    ['handleConfirm', 'const handleSkipConfirm'],
    ['handleDeleteFeed', 'const handleQuickAddSolidFood'],
  ] as const) {
    assert.match(
      handlerSource(handlerName, nextDeclaration),
      /if \(res\.ok && json\.success\)/,
      `${handlerName} should require an HTTP success response`,
    );
  }

  const medicationHandler = handlerSource('handleConfirmMed', 'const handleDeleteMed');
  assert.match(medicationHandler, /if \(res\.ok && json\.success\) \{[\s\S]*setShowMedConfirm\(false\)/);
});

test('declares the multi-record event labels and approved palette', () => {
  assert.match(trendSource, /便便/);
  assert.match(trendSource, /吃药/);
  assert.match(trendSource, /辅食/);
  assert.match(trendSource, /清醒/);
  for (const color of ['#B8A08A', '#8B9EAF', '#6F9B78', '#7BAF8E', '#FFFCF8']) {
    assert.match(trendSource, new RegExp(color.replace('#', '\\#')));
  }
});

test('renders event markers and an explicit trend tooltip from event points', () => {
  assert.match(trendSource, /EVENT_TYPES/);
  assert.match(trendSource, /EventMarker|TrendBarWithEvents/);
  assert.match(trendSource, /payload\[0\]\.payload/);
  assert.match(trendSource, /total_ml/);
  assert.match(trendSource, /有奶量记录：\{point\.measured_count\} 次/);
  assert.match(trendSource, /awake_minutes/);
  assert.match(trendSource, /fill=\{['"]#E3B87A['"]\}|#D9917A/);
});

test('anchors event markers to the shared chart plot top', () => {
  assert.match(trendSource, /SHARED_CHART_TOP_MARGIN\s*=\s*56/);
  assert.match(trendSource, /EVENT_PLOT_TOP\s*=\s*SHARED_CHART_TOP_MARGIN/);
  assert.match(trendSource, /margin=\{\{ top: SHARED_CHART_TOP_MARGIN/);
});
