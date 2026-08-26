# 奶量趋势统计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在历史记录覆盖层增加按天、按周、按月的奶量趋势图，默认覆盖近 90 天，并保持现有首页快速记录体验。

**Architecture:** 服务端按房间和聚合粒度读取指定时间范围内的喂奶记录，在共享纯函数中生成连续的日/周/月统计点；API 只返回聚合结果。历史覆盖层中的独立客户端图表组件负责粒度切换、加载/错误/空状态和 Recharts 绘制，复用现有暖色设计与历史入口。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, better-sqlite3, Recharts 2, node:test, Tailwind CSS 4.

---

## 文件结构

- Create: `src/lib/feed-stats.ts` — 趋势粒度、范围、周期键、连续 bucket 和聚合纯函数；服务端与测试共用。
- Modify: `src/storage/database/time.ts` — 增加趋势范围的时间边界工具，不改变现有 1–30 天历史接口行为。
- Modify: `src/storage/database/sqlite.ts` — 增加按房间和范围读取奶量统计所需字段的仓储函数。
- Create: `src/app/api/rooms/[id]/feed-stats/route.ts` — 校验粒度/范围并返回聚合序列。
- Create: `src/components/feed-volume-trend.tsx` — 历史覆盖层顶部的总量摘要、日/周/月切换和 Recharts 柱状图。
- Modify: `src/app/page.tsx` — 在历史覆盖层中复用现有“历史记录”入口渲染趋势组件，并传入房间/刷新上下文。
- Create: `tests/feed-stats.test.ts` — 周期边界、聚合和连续空 bucket 的纯函数测试。
- Create: `tests/feed-stats-api.test.ts` — API 合法/非法参数、房间隔离和聚合字段测试。
- Modify: `tests/page-request-contract.test.ts` — 页面必须渲染趋势组件并保留历史请求门控契约。

### Task 1: 建立趋势领域函数（TDD）

**Files:**
- Create: `tests/feed-stats.test.ts`
- Create: `src/lib/feed-stats.ts`
- Modify: `src/storage/database/time.ts:1-32`

- [ ] **Step 1: 写失败测试，固定中国时间和三种聚合范围**

在 `tests/feed-stats.test.ts` 覆盖以下行为：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFeedTrend,
  getTrendBucketCount,
  getTrendRangeStart,
  type FeedTrendGranularity,
} from '../src/lib/feed-stats';

const now = new Date('2026-08-25T04:00:00.000Z'); // 北京 12:00

test('uses 90 daily buckets, 12 weekly buckets, and 12 monthly buckets', () => {
  assert.equal(getTrendBucketCount('day'), 90);
  assert.equal(getTrendBucketCount('week'), 12);
  assert.equal(getTrendBucketCount('month'), 12);
});

test('keeps the 08:00 China cycle boundary for daily buckets', () => {
  const points = buildFeedTrend('day', now, [
    { started_at: '2026-08-24T23:59:59.000Z', amount_ml: 80 }, // 北京 07:59:59，归前一天
    { started_at: '2026-08-25T00:00:00.000Z', amount_ml: 120 }, // 北京 08:00，归当天
  ]);
  assert.equal(points.at(-2)?.total_ml, 80);
  assert.equal(points.at(-1)?.total_ml, 120);
});

test('aggregates measured amounts and preserves unmeasured feed counts', () => {
  const points = buildFeedTrend('day', now, [
    { started_at: '2026-08-25T01:00:00.000Z', amount_ml: 120 },
    { started_at: '2026-08-25T02:00:00.000Z', amount_ml: null },
    { started_at: '2026-08-25T03:00:00.000Z', amount_ml: 80 },
  ]);
  const current = points.at(-1)!;
  assert.deepEqual(
    { total_ml: current.total_ml, feed_count: current.feed_count, measured_count: current.measured_count },
    { total_ml: 200, feed_count: 3, measured_count: 2 },
  );
});

test('groups records by Monday weeks and China-local calendar months', () => {
  const weekly = buildFeedTrend('week', now, [
    { started_at: '2026-08-17T01:00:00.000Z', amount_ml: 100 },
    { started_at: '2026-08-23T23:00:00.000Z', amount_ml: 150 },
  ]);
  const monthly = buildFeedTrend('month', now, [
    { started_at: '2026-07-31T16:30:00.000Z', amount_ml: 90 }, // 北京 8 月 1 日 00:30
  ]);
  assert.equal(weekly.at(-1)?.total_ml, 250);
  assert.equal(monthly.at(-1)?.total_ml, 90);
});

test('returns a range start matching the selected bucket count', () => {
  for (const granularity of ['day', 'week', 'month'] as FeedTrendGranularity[]) {
    assert.ok(Date.parse(getTrendRangeStart(granularity, now)) < now.getTime());
  }
});
```

- [ ] **Step 2: 运行纯函数测试，确认当前实现不存在**

Run: `pnpm test -- tests/feed-stats.test.ts`

Expected: FAIL because `src/lib/feed-stats.ts` and its exported functions do not exist.

- [ ] **Step 3: 实现最小趋势函数和边界工具**

在 `src/lib/feed-stats.ts` 定义并导出：

```ts
export type FeedTrendGranularity = 'day' | 'week' | 'month';
export interface FeedTrendInput { started_at: string; amount_ml: number | null; }
export interface FeedTrendPoint {
  period_start: string;
  label: string;
  total_ml: number;
  feed_count: number;
  measured_count: number;
}
export const TREND_BUCKET_COUNTS: Record<FeedTrendGranularity, number> = {
  day: 90,
  week: 12,
  month: 12,
};
export function getTrendBucketCount(granularity: FeedTrendGranularity): number;
export function getTrendRangeStart(granularity: FeedTrendGranularity, now?: Date): string;
export function buildFeedTrend(
  granularity: FeedTrendGranularity,
  now: Date,
  records: FeedTrendInput[],
): FeedTrendPoint[];
```

Use UTC date keys for the daily 08:00 China cycle (08:00 Beijing equals 00:00 UTC), shift by +8 hours for week/month local-calendar calculations, start weeks on Monday, and create all expected buckets before applying records so empty periods return `total_ml: 0`. Count every input record in `feed_count`; only finite non-null `amount_ml` values contribute to `total_ml` and `measured_count`.

In `src/storage/database/time.ts`, add a named constant/export only if the pure helper needs it; preserve the existing `getChinaCycleStart` 30-day clamp so current API tests remain unchanged. The new trend range math must not call the 30-day-limited function for 90-day/month ranges.

- [ ] **Step 4: Run the tests and verify the domain behavior passes**

Run: `pnpm test -- tests/feed-stats.test.ts tests/time.test.ts`

Expected: PASS for all trend and existing China-cycle tests.

- [ ] **Step 5: Commit the domain layer**

```bash
git add src/lib/feed-stats.ts src/storage/database/time.ts tests/feed-stats.test.ts
git commit -m "feat: add milk volume trend aggregation"
```

### Task 2: Add the server-side feed statistics API (TDD)

**Files:**
- Modify: `src/storage/database/sqlite.ts` after `getFeeds`
- Create: `src/app/api/rooms/[id]/feed-stats/route.ts`
- Create: `tests/feed-stats-api.test.ts`

- [ ] **Step 1: Write failing storage/API tests**

Use the same temporary SQLite setup pattern as `tests/solid-food-api.test.ts`. Insert records for two rooms, measured and unmeasured feeds, and dates spanning two day/weekly/monthly buckets. Assert the route returns only the requested room and this exact shape:

```ts
{
  success: true,
  data: {
    granularity: 'day',
    bucket_count: 90,
    points: [{
      period_start: '2026-08-25',
      label: '08月25日',
      total_ml: 200,
      feed_count: 3,
      measured_count: 2,
    }, /* continuous zero buckets */],
  },
}
```

Also assert `granularity=hour` and a non-positive/oversized `range` return status 400, a missing room returns 404, and `week`/`month` responses use `bucket_count: 12`.

- [ ] **Step 2: Run the focused API test to verify it fails**

Run: `pnpm test -- tests/feed-stats-api.test.ts`

Expected: FAIL because the route and repository function are not defined.

- [ ] **Step 3: Implement the repository query and route**

Add to `src/storage/database/sqlite.ts`:

```ts
export function getFeedTrendRecords(roomId: string, startIso: string): Array<Pick<FeedRow, 'started_at' | 'amount_ml'>> {
  return getDatabase().prepare(`
    SELECT started_at, amount_ml
    FROM feed_records
    WHERE room_id = ? AND started_at >= ?
    ORDER BY started_at ASC
  `).all(roomId, startIso) as Array<Pick<FeedRow, 'started_at' | 'amount_ml'>>;
}
```

Create `GET` in `src/app/api/rooms/[id]/feed-stats/route.ts`: parse `granularity` from `day|week|month`, set the fixed bucket count from `TREND_BUCKET_COUNTS`, optionally accept `range` only when it is a positive integer no larger than that fixed count, call `getTrendRangeStart`, `getFeedTrendRecords`, and `buildFeedTrend`, then return the response shape above. Check `getRoomById` before querying. Return `{ success: false, error: '无效的统计粒度或范围' }` with 400 for invalid inputs and `{ success: false, error: '房间不存在' }` with 404 for an unknown room.

- [ ] **Step 4: Run focused tests and existing API regression tests**

Run: `pnpm test -- tests/feed-stats-api.test.ts tests/solid-food-api.test.ts`

Expected: PASS, including room isolation, measured/unmeasured counts, fixed bucket counts, and existing API behavior.

- [ ] **Step 5: Commit the API layer**

```bash
git add src/storage/database/sqlite.ts src/app/api/rooms/[id]/feed-stats/route.ts tests/feed-stats-api.test.ts
git commit -m "feat: expose aggregated milk volume trends"
```

### Task 3: Build the trend UI component (TDD)

**Files:**
- Create: `src/components/feed-volume-trend.tsx`
- Modify: `tests/page-request-contract.test.ts`

- [ ] **Step 1: Add a failing page contract for the history entry and controls**

Extend `tests/page-request-contract.test.ts` with assertions that `page.tsx` imports and renders `FeedVolumeTrend` inside the history branch, and that the component source contains the three labels and endpoint query:

```ts
assert.match(pageSource, /FeedVolumeTrend/);
assert.match(pageSource, /<FeedVolumeTrend/);
assert.match(pageSource, /historyFeeds/);

const trendSource = readFileSync(new URL('../src/components/feed-volume-trend.tsx', import.meta.url), 'utf8');
assert.match(trendSource, /按天/);
assert.match(trendSource, /按周/);
assert.match(trendSource, /按月/);
assert.match(trendSource, /feed-stats\?granularity=/);
assert.match(trendSource, /aria-pressed/);
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `pnpm test -- tests/page-request-contract.test.ts`

Expected: FAIL because the component and page integration do not exist.

- [ ] **Step 3: Implement `FeedVolumeTrend` with explicit loading/error/empty states**

Create a `'use client'` component with props:

```ts
interface FeedVolumeTrendProps {
  roomId: string;
  todayTotalMl: number;
  refreshKey: string;
}
```

Use local `granularity` state defaulting to `'day'`, map the range to `{ day: 90, week: 12, month: 12 }`, fetch `/api/rooms/${encodeURIComponent(roomId)}/feed-stats?granularity=${granularity}&range=${range}`, and guard late responses with an incrementing request id plus `AbortController`. Render:

- a compact summary row with `今日总量` and `todayTotalMl ml`;
- three touch-sized buttons with `aria-pressed`, selected background `#D9917A`, unselected background `#FFF3E6`;
- a `ChartContainer` configured with `volume: { label: '奶量', color: '#E3B87A' }`;
- `BarChart`, `CartesianGrid`, `XAxis`, `YAxis`, `ChartTooltip`, `Bar`, and `Cell` from `recharts`; use `#E3B87A` for ordinary bars and `#D9917A` for the maximum positive `total_ml`;
- Chinese tooltip content showing period label, total ml, feed count, and measured count;
- a warm empty state when all `measured_count` values are zero, an inline retry button on request errors, and a small loading label while fetching.

Keep all chart text and controls code-native; use `min-w-0`, responsive container sizing, sampled X-axis labels for the 90-day view, and `tabular-nums` for values. Do not add a new global dark-mode rule or alter `globals.css`.

- [ ] **Step 4: Run the contract and type checks**

Run: `pnpm test -- tests/page-request-contract.test.ts && pnpm run ts-check`

Expected: PASS with the component types and Recharts props accepted by TypeScript.

- [ ] **Step 5: Commit the component**

```bash
git add src/components/feed-volume-trend.tsx tests/page-request-contract.test.ts
git commit -m "feat: add milk volume trend chart"
```

### Task 4: Integrate the component into the existing history overlay

**Files:**
- Modify: `src/app/page.tsx` near imports and the `showHistory` overlay

- [ ] **Step 1: Add the component import and a stable feed refresh key**

Import `FeedVolumeTrend` and derive a render-stable key from the current room feed records, for example:

```ts
const feedTrendRefreshKey = room.feeds
  .map((feed) => `${feed.id}:${feed.amount_ml ?? ''}:${feed.started_at}`)
  .join('|');
```

Keep this derivation after the `room` null/setup guard so it never reads `room.feeds` when no room exists.

- [ ] **Step 2: Render the trend at the top of the existing history overlay**

Inside `{showHistory && (...)}`, place:

```tsx
<FeedVolumeTrend
  roomId={room.id}
  todayTotalMl={todayTotalMl}
  refreshKey={feedTrendRefreshKey}
/>
```

after the overlay header and before the existing raw-list range controls. Preserve the existing 7/14/30 list range buttons, history loading/error branches, swipe-to-delete rows, and close behavior.

- [ ] **Step 3: Run page and regression tests**

Run: `pnpm test -- tests/page-request-contract.test.ts tests/request-state.test.ts tests/swipe-to-delete.test.ts`

Expected: PASS; deleting or refreshing records must continue to use the existing latest-request gates and history snapshot loader.

- [ ] **Step 4: Commit the page integration**

```bash
git add src/app/page.tsx
git commit -m "feat: place milk trends in history overlay"
```

### Task 5: Full verification and visual QA

**Files:**
- No new source files; verify all changed files and the existing `DESIGN.md` constraints.

- [ ] **Step 1: Run the full automated suite**

Run: `pnpm test`

Expected: all tests PASS.

- [ ] **Step 2: Run static checks and production build**

Run: `pnpm run ts-check && pnpm run lint:build && pnpm run build`

Expected: TypeScript, ESLint, and Next production build complete with exit code 0.

- [ ] **Step 3: Verify the rendered history workflow in the browser**

Start the app with `pnpm run dev`, open the existing room or create a test room, and check at desktop and mobile widths:

1. “历史记录” remains the only trend entry point.
2. History overlay shows the trend above the raw record list.
3. Default “按天” has 90 points/range; “按周” has 12 points; “按月” has 12 points.
4. Buttons expose selected state and switch data without stale responses overwriting the current view.
5. 杏仁橙 ordinary bars and 玫瑰珊瑚 maximum bar remain readable on the warm-white card; there is no accidental dark/light inversion.
6. Tooltip, empty state, error/retry, narrow-screen sizing, and existing quick-add/delete flows work.

- [ ] **Step 4: Inspect the final diff and report any intentional deviations**

Run: `git status --short && git diff HEAD~4..HEAD --stat && git diff --check`

Expected: only the documented trend feature files and tests are changed; no generated `.superpowers` brainstorming artifacts are staged.

- [ ] **Step 5: Commit any final verification-only fixes**

```bash
git add src tests docs/superpowers/plans/2026-08-26-milk-volume-trend.md
git commit -m "chore: verify milk trend statistics"
```

## Plan self-review

- Spec coverage: daily/weekly/monthly ranges and default, server aggregation, amount-only totals, continuous zero buckets, existing history entry, B colors, loading/error/empty states, accessibility, responsive layout, and regression/build checks are covered by Tasks 1–5.
- Placeholder scan: no `TBD`, `TODO`, “implement later”, or unspecified “appropriate handling” steps are present.
- Type consistency: `FeedTrendGranularity`, `FeedTrendPoint`, `getTrendBucketCount`, `getTrendRangeStart`, `buildFeedTrend`, `getFeedTrendRecords`, and `FeedVolumeTrendProps` are defined before their consumers and use consistent `period_start`, `total_ml`, `feed_count`, and `measured_count` names.
