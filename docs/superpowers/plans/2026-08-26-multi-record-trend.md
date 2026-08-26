# 多记录趋势图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有历史记录奶量趋势图中增加便便、吃药、辅食和清醒事件点，并保持已确认的 A 配色、B 展示形式和浅色主题。

**Architecture:** 保留现有奶量趋势的周期计算和 API 地址，在服务端同一次统计请求中读取五类记录并聚合为统一周期点；客户端继续使用现有 `FeedVolumeTrend`，将事件点绘制在奶量柱的自定义形状中，tooltip 读取同一周期的事件统计。事件聚合放在独立纯函数中，避免把数据库和图表细节混在一起。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, better-sqlite3, Recharts 2.15, node:test, Tailwind CSS 4.

---

## 文件结构

- Modify: `src/lib/feed-stats.ts` — 导出统一的周期起点计算，修正周/月也遵守北京时间 08:00 业务日边界。
- Create: `src/lib/multi-record-stats.ts` — 定义五类记录输入、事件统计类型和纯聚合函数。
- Modify: `src/storage/database/sqlite.ts` — 增加一次读取五类趋势记录的仓储函数，查询继续集中在 SQLite 层。
- Modify: `src/app/api/rooms/[id]/feed-stats/route.ts` — 调用多记录仓储和聚合函数，保持原 endpoint、粒度和范围校验。
- Modify: `src/components/feed-volume-trend.tsx` — 扩展响应类型、颜色配置、事件点、图例、tooltip 和浅色 tooltip 表面。
- Modify: `src/app/page.tsx` — 所有五类记录新增/删除成功后刷新趋势组件。
- Create: `tests/multi-record-stats.test.ts` — 五类记录周期聚合、清醒时长和边界测试。
- Modify: `tests/feed-stats.test.ts` — 补充周/月 08:00 业务日边界回归测试。
- Modify: `tests/feed-stats-api.test.ts` — 扩展 API 响应事件字段、房间隔离和参数回归。
- Modify: `tests/page-request-contract.test.ts` — 验证事件颜色、tooltip、图例和五类刷新契约。

## Task 1: 固定共享周期口径并建立多记录聚合纯函数（TDD）

**Files:**
- Modify: `src/lib/feed-stats.ts`
- Create: `src/lib/multi-record-stats.ts`
- Modify: `tests/feed-stats.test.ts`
- Create: `tests/multi-record-stats.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖周/月 08:00 边界和五类事件聚合**

在 `tests/multi-record-stats.test.ts` 写入以下测试数据结构和断言：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMultiRecordTrend, type MultiTrendRecords } from '../src/lib/multi-record-stats';

const NOW = new Date('2026-08-26T03:00:00.000Z'); // 北京 11:00
const emptyRecords = (): MultiTrendRecords => ({
  feeds: [], poops: [], medications: [], solid_foods: [], awakes: [],
});

test('aggregates five record types into the same daily bucket', () => {
  const records = emptyRecords();
  records.feeds = [{ started_at: '2026-08-26T01:00:00.000Z', amount_ml: 120 }];
  records.poops = [{ started_at: '2026-08-26T02:00:00.000Z' }];
  records.medications = [{ started_at: '2026-08-26T02:30:00.000Z' }];
  records.solid_foods = [{ started_at: '2026-08-26T02:45:00.000Z' }];
  records.awakes = [{ started_at: '2026-08-26T00:00:00.000Z', ended_at: '2026-08-26T00:35:00.000Z' }];

  const current = buildMultiRecordTrend('day', NOW, records).at(-1)!;
  assert.deepEqual(current.events, {
    poop_count: 1,
    medication_count: 1,
    solid_food_count: 1,
    awake_count: 1,
    awake_minutes: 35,
  });
  assert.equal(current.total_ml, 120);
});

test('does not count an active awake record and ignores invalid durations', () => {
  const records = emptyRecords();
  records.awakes = [
    { started_at: '2026-08-26T00:00:00.000Z', ended_at: null },
    { started_at: '2026-08-26T01:00:00.000Z', ended_at: '2026-08-26T00:59:00.000Z' },
    { started_at: 'not-a-date', ended_at: '2026-08-26T02:00:00.000Z' },
  ];
  const current = buildMultiRecordTrend('day', NOW, records).at(-1)!;
  assert.deepEqual(current.events, {
    poop_count: 0,
    medication_count: 0,
    solid_food_count: 0,
    awake_count: 0,
    awake_minutes: 0,
  });
});

test('keeps event-only periods and applies the 08:00 business-day boundary to week/month', () => {
  const records = emptyRecords();
  records.poops = [{ started_at: '2026-08-25T23:59:59.000Z' }]; // 北京 8 月 26 日 07:59:59，前一业务日
  records.medications = [{ started_at: '2026-08-26T00:00:00.000Z' }]; // 北京 8 月 26 日 08:00
  const weekly = buildMultiRecordTrend('week', NOW, records);
  const monthly = buildMultiRecordTrend('month', NOW, records);
  assert.equal(weekly.reduce((sum, point) => sum + point.events.poop_count, 0), 1);
  assert.equal(weekly.reduce((sum, point) => sum + point.events.medication_count, 0), 1);
  assert.equal(monthly.at(-1)?.events.medication_count, 1);
});
```

在 `tests/feed-stats.test.ts` 增加周一凌晨 08:00 前后的断言，明确 `2026-08-23T16:00:00.000Z`（北京时间周一 00:00）仍归前一个业务周，而 `2026-08-24T00:00:00.000Z`（北京时间周一 08:00）归新业务周；月边界同样覆盖北京时间 1 日 08:00。

- [ ] **Step 2: 运行聚合测试，确认新导出和边界行为失败**

Run: `pnpm test -- tests/multi-record-stats.test.ts tests/feed-stats.test.ts`

Expected: FAIL，因为 `multi-record-stats.ts` 和统一周期起点导出尚未实现，且当前周/月函数还没有按 08:00 业务日归桶。

- [ ] **Step 3: 暴露统一周期起点并实现最小多记录聚合**

在 `src/lib/feed-stats.ts` 中导出：

```ts
export function getTrendPeriodStart(granularity: FeedTrendGranularity, date: Date): string {
  const key = keyFor(granularity, date);
  return periodStart(granularity, key).toISOString();
}
```

先把 `keyFor` 改为从北京时间本地日期生成“业务日”：北京时间小时小于 8 时先减一天，再由该业务日计算 day/week/month；这样周/月与日使用同一 08:00 边界。保留现有 90/12/12 bucket 数量和已有 `buildFeedTrend` 字段。

在 `src/lib/multi-record-stats.ts` 定义：

```ts
import { buildFeedTrend, getTrendPeriodStart, type FeedTrendGranularity, type FeedTrendInput, type FeedTrendPoint } from './feed-stats';

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

export function buildMultiRecordTrend(
  granularity: FeedTrendGranularity,
  now: Date,
  records: MultiTrendRecords,
): MultiTrendPoint[];
```

Implement the function by calling `buildFeedTrend` for the continuous base points, creating a `Map` keyed by `period_start`, and adding each valid event to the point returned by `getTrendPeriodStart`. For awake records, require both dates to parse, require `ended_at >= started_at`, exclude `ended_at === null`, and add `Math.round((end - start) / 60000)` minutes. Never mutate the input arrays; initialize every bucket with zero event counts.

- [ ] **Step 4: Run the domain tests and confirm all existing milk behavior still passes**

Run: `pnpm test -- tests/multi-record-stats.test.ts tests/feed-stats.test.ts tests/time.test.ts`

Expected: PASS, including continuous empty buckets, existing milk totals, and the new week/month 08:00 boundary.

- [ ] **Step 5: Commit the shared aggregation layer**

```bash
git add src/lib/feed-stats.ts src/lib/multi-record-stats.ts tests/feed-stats.test.ts tests/multi-record-stats.test.ts
git commit -m "feat: aggregate multi-record trend events"
```

## Task 2: Extend SQLite reads and the existing feed-stats API (TDD)

**Files:**
- Modify: `src/storage/database/sqlite.ts`
- Modify: `src/app/api/rooms/[id]/feed-stats/route.ts`
- Modify: `tests/feed-stats-api.test.ts`

- [ ] **Step 1: Extend the API test fixture with all five record tables**

Import `insertPoop`, `insertMedication`, `insertAwake`, and `insertSolidFood` into `tests/feed-stats-api.test.ts`. In the existing room-isolation test, insert one current-bucket record for each type and one event in `otherRoom`. Update the expected point keys to include `events`, then assert:

```ts
assert.deepEqual(payload.data.points.at(-1).events, {
  poop_count: 1,
  medication_count: 1,
  solid_food_count: 1,
  awake_count: 1,
  awake_minutes: 30,
});
```

Add a second test with an active awake record and a previous-business-day event to verify active awake is omitted and events still aggregate into continuous buckets. Keep the existing invalid parameter and 404 tests unchanged.

- [ ] **Step 2: Run the focused API tests to verify the response contract fails**

Run: `pnpm test -- tests/feed-stats-api.test.ts`

Expected: FAIL because the route currently returns points without an `events` object and only queries `feed_records`.

- [ ] **Step 3: Add one repository function returning the five typed record sets**

In `src/storage/database/sqlite.ts`, add after `getFeedTrendRecords`:

```ts
export type MultiTrendRecordSets = {
  feeds: Array<Pick<FeedRow, 'started_at' | 'amount_ml'>>;
  poops: Array<Pick<PoopRow, 'started_at'>>;
  medications: Array<Pick<MedicationRow, 'started_at'>>;
  solid_foods: Array<Pick<SolidFoodRow, 'started_at'>>;
  awakes: Array<Pick<AwakeRow, 'started_at' | 'ended_at'>>;
};

export function getMultiTrendRecords(roomId: string, startIso: string): MultiTrendRecordSets {
  const db = getDatabase();
  const read = <T>(table: string, columns: string[]) =>
    db.prepare(`SELECT ${columns.join(', ')} FROM ${table} WHERE room_id = ? AND started_at >= ? ORDER BY started_at ASC`).all(roomId, startIso) as T[];
  return {
    feeds: read('feed_records', ['started_at', 'amount_ml']),
    poops: read('poop_records', ['started_at']),
    medications: read('medication_records', ['started_at']),
    solid_foods: read('solid_food_records', ['started_at']),
    awakes: read('awake_records', ['started_at', 'ended_at']),
  };
}
```

Keep table names and column lists hard-coded at this call site; do not accept table names from request input. This preserves room isolation and the existing “queries live in sqlite.ts” rule.

- [ ] **Step 4: Make the route return `MultiTrendPoint[]` without changing URL or validation**

In `src/app/api/rooms/[id]/feed-stats/route.ts`, replace the `getFeedTrendRecords` import/call with `getMultiTrendRecords`, import `buildMultiRecordTrend`, and return:

```ts
const records = getMultiTrendRecords(id, getTrendRangeStart(granularity, now));
const allPoints = buildMultiRecordTrend(granularity, now, records);
const points = range === maxCount ? allPoints : allPoints.slice(-range);
return NextResponse.json({
  success: true,
  data: { granularity, bucket_count: points.length, points },
});
```

Keep `day|week|month` validation, max ranges `90|12|12`, room existence check, 400 message, and 404 message exactly as they are. The API should fail the whole request on a database error rather than returning a partial event set.

- [ ] **Step 5: Run API and regression tests, then commit**

Run: `pnpm test -- tests/feed-stats-api.test.ts tests/solid-food-api.test.ts tests/time.test.ts`

Expected: PASS with five-type event fields, room isolation, continuous points, and unchanged CRUD API behavior.

```bash
git add src/storage/database/sqlite.ts src/app/api/rooms/[id]/feed-stats/route.ts tests/feed-stats-api.test.ts
git commit -m "feat: return multi-record trend statistics"
```

## Task 3: Render event points, legend, and a light-theme tooltip in `FeedVolumeTrend`

**Files:**
- Modify: `src/components/feed-volume-trend.tsx`
- Modify: `tests/page-request-contract.test.ts`

- [ ] **Step 1: Add source-level UI contract assertions before changing the component**

Extend `tests/page-request-contract.test.ts` with assertions for the approved colors and event labels:

```ts
assert.match(trendSource, /便便/);
assert.match(trendSource, /吃药/);
assert.match(trendSource, /辅食/);
assert.match(trendSource, /清醒/);
for (const color of ['#B8A08A', '#8B9EAF', '#6F9B78', '#7BAF8E', '#FFFCF8']) {
  assert.match(trendSource, new RegExp(color.replace('#', '\\#')));
}
assert.match(trendSource, /events-on-bar|EventMarker|事件点/);
assert.match(trendSource, /今日总量/);
```

- [ ] **Step 2: Run the contract test to establish the missing UI contract**

Run: `pnpm test -- tests/page-request-contract.test.ts`

Expected: FAIL on the new event labels/colors because the existing component only renders奶量 bars.

- [ ] **Step 3: Extend response types and flatten event fields for chart rendering**

In `src/components/feed-volume-trend.tsx`, add:

```ts
interface TrendEventCounts {
  poop_count: number;
  medication_count: number;
  solid_food_count: number;
  awake_count: number;
  awake_minutes: number;
}

interface FeedTrendPoint {
  period_start: string;
  label: string;
  total_ml: number;
  feed_count: number;
  measured_count: number;
  events: TrendEventCounts;
}
```

Before rendering the chart, derive `chartPoints` by copying each point and flattening `point.events` into a local object only for labels/tooltips. Do not change the API’s nested `events` response shape.

- [ ] **Step 4: Add the approved event colors and custom bar shape**

Define a constant event list in the component:

```ts
const EVENT_TYPES = [
  { key: 'poop_count', label: '便便', color: '#B8A08A' },
  { key: 'medication_count', label: '吃药', color: '#8B9EAF' },
  { key: 'solid_food_count', label: '辅食', color: '#6F9B78' },
  { key: 'awake_count', label: '清醒', color: '#7BAF8E' },
] as const;
```

Replace the visible `Bar` shape with a `TrendBarWithEvents` custom SVG shape that:

- draws the normal rectangle using the `fill` received from each `Cell` (`#E3B87A` or `#D9917A`);
- draws at most one 6–8px circle per event type with a non-zero count;
- uses four fixed 10px vertical lanes, all centered on the bar’s x coordinate, so multiple event types never overlap;
- uses a chart top margin of at least 52px so the marker lanes remain visible above the tallest bar;
- falls back to a fixed plot-top anchor when `total_ml === 0`, so event-only periods still show dots.

Keep `BarChart`, `CartesianGrid`, `XAxis`, and `YAxis` as the existing chart primitives. Do not add a second numeric axis or encode event counts as bar heights.

- [ ] **Step 5: Replace the generic tooltip with an explicit light-theme period summary and add the legend**

Create a small `TrendTooltip` component that reads `payload?.[0]?.payload` and renders only non-zero event categories. It must use inline styles, not `bg-background` or `.dark` variables:

```tsx
<div style={{ backgroundColor: '#FFFCF8', border: '1px solid #EDE5DC', color: '#3D3229' }}>
  <div>{point.label}</div>
  <div>总奶量 {point.total_ml} ml</div>
  <div>喂奶 {point.feed_count} 次</div>
  {point.events.poop_count > 0 && <div>便便 {point.events.poop_count} 次</div>}
  {point.events.medication_count > 0 && <div>吃药 {point.events.medication_count} 次</div>}
  {point.events.solid_food_count > 0 && <div>辅食 {point.events.solid_food_count} 次</div>}
  {point.events.awake_count > 0 && <div>清醒 {point.events.awake_count} 次，共 {formatAwakeMinutes(point.events.awake_minutes)}</div>}
</div>
```

Wire it to `ChartTooltip content={<TrendTooltip />}`. Add a text legend below the chart with one colored dot and label for each event type. Keep `aria-label="奶量趋势"`, `aria-pressed`, loading/error/empty states, sampled long-range X-axis labels, and the existing max-bar highlight.

- [ ] **Step 6: Run UI contract and TypeScript checks, then commit**

Run: `pnpm test -- tests/page-request-contract.test.ts && pnpm run ts-check`

Expected: PASS; the component compiles with Recharts custom shape/tooltip props and contains the approved event labels/colors without adding a dark-mode dependency.

```bash
git add src/components/feed-volume-trend.tsx tests/page-request-contract.test.ts
git commit -m "feat: show multi-record events on trend chart"
```

## Task 4: Refresh the trend after every record mutation

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `tests/page-request-contract.test.ts`

- [ ] **Step 1: Extend the page contract for all five mutation families**

Add assertions that the source contains `setFeedTrendRefreshNonce((value) => value + 1)` in the successful mutation paths for:

```ts
const mutationNames = [
  'handleConfirm',
  'handleDeleteFeed',
  'handleQuickAddPoop',
  'handleDeletePoop',
  'handleQuickAddMedicine',
  'handleDeleteMed',
  'handleQuickAddAwake',
  'handleDeleteAwake',
  'handleQuickAddSolidFood',
  'handleDeleteSolidFood',
];
```

Each assertion should slice the handler body between that function declaration and the next `const handle...` declaration, then match the nonce increment so a failed request cannot refresh the chart.

- [ ] **Step 2: Run the contract test and observe missing event refreshes**

Run: `pnpm test -- tests/page-request-contract.test.ts`

Expected: FAIL for the non-feed handlers because the existing nonce only changes after feed add/delete.

- [ ] **Step 3: Increment the existing nonce only after successful event mutations**

In `src/app/page.tsx`, keep the existing `feedTrendRefreshNonce` state and add the same increment immediately after each successful `res.ok` branch for poop, medication, awake, and solid-food create/delete handlers. Do not increment before a fetch, on validation errors, or on failed responses. Keep the prop construction:

```tsx
<FeedVolumeTrend
  roomId={room.id}
  todayTotalMl={todayTotalMl}
  refreshKey={feedTrendRefreshKey}
/>
```

unchanged, so the trend component refetches the same selected granularity whenever any record type changes.

- [ ] **Step 4: Run request-state, deletion, and page contract regressions, then commit**

Run: `pnpm test -- tests/page-request-contract.test.ts tests/request-state.test.ts tests/swipe-to-delete.test.ts`

Expected: PASS; existing history snapshot request gates and deletion flows remain intact.

```bash
git add src/app/page.tsx tests/page-request-contract.test.ts
git commit -m "feat: refresh trends after record mutations"
```

## Task 5: Full verification and visual QA

**Files:**
- Verify: `src/lib/feed-stats.ts`, `src/lib/multi-record-stats.ts`, `src/storage/database/sqlite.ts`, `src/app/api/rooms/[id]/feed-stats/route.ts`, `src/components/feed-volume-trend.tsx`, `src/app/page.tsx`, and the four test files.

- [ ] **Step 1: Run the complete automated suite**

Run: `pnpm test`

Expected: all existing and new tests PASS, including multi-record domain/API contracts and history mutation refresh contracts.

- [ ] **Step 2: Run static checks and production build**

Run: `pnpm run ts-check && pnpm run lint:build && pnpm run build`

Expected: TypeScript, ESLint, and the Next production build exit with code 0.

- [ ] **Step 3: Run the local app and inspect the approved interaction at desktop and mobile widths**

Run: `pnpm run dev` (the project script uses port 5001). Open the history entry for a room containing at least one feed, poop, medication, solid-food, and completed awake record. Verify:

1. History remains the only statistics entry point.
2. The default daily view shows the 90-day range; weekly and monthly views show 12 periods.
3. Ordinary bars are `#E3B87A`, the visible maximum is `#D9917A`, and event dots use A colors.
4. Event-only periods still show dots; dots never change the ml axis or overlap each other.
5. Tooltip shows only non-zero events, and awake includes count plus total minutes.
6. The chart card and tooltip remain `#FFFCF8`/warm light colors even when the OS/browser prefers dark mode.
7. Adding or deleting any of the five record types causes the trend to refetch without regressing the existing history list.
8. Loading, retry, empty state, long-range labels, touch-sized controls, and narrow mobile layout remain usable.

- [ ] **Step 4: Inspect the final diff and keep generated brainstorming files out of commits**

Run: `git status --short && git diff --check && git diff HEAD~4..HEAD --stat`

Expected: only the documented source, test, and plan files are staged/committed; `.superpowers/` remains untracked local brainstorming state and is not added.

- [ ] **Step 5: Commit only verification fixes if needed**

```bash
git add src/lib/feed-stats.ts src/lib/multi-record-stats.ts src/storage/database/sqlite.ts src/app/api/rooms/[id]/feed-stats/route.ts src/components/feed-volume-trend.tsx src/app/page.tsx tests docs/superpowers/plans/2026-08-26-multi-record-trend.md
git commit -m "chore: verify multi-record trend chart"
```

