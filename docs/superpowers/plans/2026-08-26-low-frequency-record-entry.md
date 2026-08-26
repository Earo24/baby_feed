# Low-Frequency Record Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the awake and medication carousel actions with a visually distinctive More entry while keeping active-awake completion directly available on the home page.

**Architecture:** Keep the existing room APIs and record forms unchanged. Put the four-item carousel contract in a small pure TypeScript module, then let `src/app/page.tsx` own the More sheet, awake-start error state, medication handoff, and active-awake action strip using `room.activeAwake` as the sole source of truth.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS 4, Lucide React, Node test runner through `tsx`.

---

## File Map

- Create `src/lib/action-carousel.ts`: typed carousel order and loop-width calculation.
- Create `tests/action-carousel.test.ts`: unit coverage for carousel order, count, and set width.
- Create `tests/low-frequency-record-entry.test.ts`: source-level component contract coverage matching the repository's existing frontend tests.
- Modify `src/app/page.tsx`: render the four actions, More preview button and sheet, awake-start error recovery, medication transition, and active-awake action strip.

### Task 1: Lock The Four-Item Carousel Contract

**Files:**
- Create: `src/lib/action-carousel.ts`
- Create: `tests/action-carousel.test.ts`
- Modify: `src/app/page.tsx:3-10,318-341`

- [ ] **Step 1: Write the failing carousel contract test**

Create `tests/action-carousel.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTION_CAROUSEL_ITEMS,
  getActionCarouselSetWidth,
} from '../src/lib/action-carousel';

test('keeps the low-frequency entry before the three direct record actions', () => {
  assert.deepEqual(ACTION_CAROUSEL_ITEMS, [
    'more',
    'poop',
    'feed',
    'solid-food',
  ]);
});

test('derives one loop width from the configured action count', () => {
  assert.equal(getActionCarouselSetWidth(140), 560);
  assert.equal(getActionCarouselSetWidth(0), 0);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run:

```bash
pnpm exec tsx --test tests/action-carousel.test.ts
```

Expected: FAIL with `Cannot find module '../src/lib/action-carousel'`.

- [ ] **Step 3: Add the minimal typed carousel module**

Create `src/lib/action-carousel.ts`:

```ts
export const ACTION_CAROUSEL_ITEMS = [
  'more',
  'poop',
  'feed',
  'solid-food',
] as const;

export type ActionCarouselItem = (typeof ACTION_CAROUSEL_ITEMS)[number];

export function getActionCarouselSetWidth(itemWidth: number): number {
  return itemWidth * ACTION_CAROUSEL_ITEMS.length;
}
```

- [ ] **Step 4: Make the loop calculation consume the shared contract**

Add the import in `src/app/page.tsx`:

```ts
import { getActionCarouselSetWidth } from '@/lib/action-carousel';
```

Replace the fixed five-item calculation inside `checkBtnLoop`:

```ts
const itemWidth = 140;
const oneSet = getActionCarouselSetWidth(itemWidth);
```

Keep the existing center-offset and three-set jump behavior unchanged.

- [ ] **Step 5: Run the focused test and static checks**

Run:

```bash
pnpm exec tsx --test tests/action-carousel.test.ts
pnpm run ts-check
```

Expected: both commands exit 0; the test reports 2 passing tests.

- [ ] **Step 6: Commit the carousel contract**

```bash
git add src/lib/action-carousel.ts tests/action-carousel.test.ts src/app/page.tsx
git commit -m "refactor: define home action carousel contract"
```

### Task 2: Add The More Entry And Active-Awake Action

**Files:**
- Create: `tests/low-frequency-record-entry.test.ts`
- Modify: `src/app/page.tsx:230-275,643-719,1029-1171`

- [ ] **Step 1: Write the failing page contract tests**

Create `tests/low-frequency-record-entry.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync(
  new URL('../src/app/page.tsx', import.meta.url),
  'utf8',
);

test('renders the approved four actions in order and removes direct low-frequency actions', () => {
  const start = pageSource.indexOf('{/* Action Buttons');
  const end = pageSource.indexOf('{showSolidFoodForm', start);
  const carousel = pageSource.slice(start, end);

  const more = carousel.indexOf('data-btn-type="more"');
  const poop = carousel.indexOf('data-btn-type="poop"');
  const feed = carousel.indexOf('data-btn-type="feed"');
  const solidFood = carousel.indexOf('data-btn-type="solid-food"');

  assert.ok(start >= 0 && end > start);
  assert.ok(more >= 0);
  assert.ok(more < poop && poop < feed && feed < solidFood);
  assert.doesNotMatch(carousel, /data-btn-type="awake"/);
  assert.doesNotMatch(carousel, /data-btn-type="med"/);
});

test('previews awake and medication inside the More button', () => {
  assert.match(pageSource, /aria-label="更多记录"/);
  assert.match(pageSource, /data-more-preview="awake"/);
  assert.match(pageSource, /data-more-preview="medication"/);
  assert.match(pageSource, />更多<\/span>/);
});

test('uses one accessible bottom sheet for both low-frequency actions', () => {
  assert.match(pageSource, /const \[showMoreRecords, setShowMoreRecords\] = useState\(false\)/);
  assert.match(pageSource, /id="more-records-title"/);
  assert.match(pageSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="more-records-title"/);
  assert.match(pageSource, /记录失败，请重试/);
  assert.match(pageSource, /setShowMoreRecords\(false\);[\s\S]*handleQuickAddMed\(\)/);
  assert.doesNotMatch(pageSource, /autoFocus/);
});

test('promotes an active awake record to a direct home action', () => {
  assert.match(pageSource, /aria-label=\{`已清醒\$\{awakeDuration\}，记为睡了`\}/);
  assert.match(pageSource, /onClick=\{handleEndAwake\}/);
  assert.match(pageSource, /已清醒 \{awakeDuration\}/);
  assert.match(pageSource, />睡了<\/span>/);
});
```

- [ ] **Step 2: Run the page contract test and verify it fails**

Run:

```bash
pnpm exec tsx --test tests/low-frequency-record-entry.test.ts
```

Expected: FAIL because the carousel still contains direct awake and medication buttons and has no More sheet.

- [ ] **Step 3: Add More-sheet state and explicit open/close transitions**

Add these states beside the other form visibility state:

```ts
const [showMoreRecords, setShowMoreRecords] = useState(false);
const [awakeStartError, setAwakeStartError] = useState<string | null>(null);
```

Add these handlers before the medication handlers:

```ts
const handleOpenMoreRecords = () => {
  if (submitting) return;
  setAwakeStartError(null);
  setShowMoreRecords(true);
};

const handleCloseMoreRecords = () => {
  if (submitting) return;
  setAwakeStartError(null);
  setShowMoreRecords(false);
};
```

Immediately after the existing `handleQuickAddMed` declaration, add the medication handoff so the referenced `const` has already been initialized:

```ts
const handleOpenMedicationFromMore = () => {
  setShowMoreRecords(false);
  handleQuickAddMed();
};
```

- [ ] **Step 4: Make awake start success and failure observable**

Replace `handleQuickAddAwake` with:

```ts
const handleQuickAddAwake = async () => {
  if (!room || submitting || room.activeAwake) return;
  setSubmitting(true);
  setAwakeStartError(null);
  haptic('heavy');
  try {
    const now = new Date();
    const res = await fetch(`/api/rooms/${room.id}/awakes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recorder_name: feederName || null,
        started_at: now.toISOString(),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      setAwakeStartError('记录失败，请重试');
      return;
    }
    setFeedTrendRefreshNonce((value) => value + 1);
    await fetchRoom(room.id);
    setShowMoreRecords(false);
  } catch {
    setAwakeStartError('记录失败，请重试');
  } finally {
    setSubmitting(false);
  }
};
```

This preserves the existing API request and trend refresh while keeping the More sheet open on failure.

- [ ] **Step 5: Replace the carousel JSX with the four approved actions**

Inside every repeated carousel set, render actions in this exact order:

```tsx
<div data-btn-type="more" aria-hidden={setIdx !== 1 || undefined} className="snap-center flex-shrink-0 flex items-center justify-center" style={{ width: 140, height: 140 }}>
  <button
    type="button"
    aria-label="更多记录"
    onClick={() => { haptic('light'); handleOpenMoreRecords(); }}
    disabled={submitting}
    tabIndex={setIdx === 1 ? 0 : -1}
    className="rounded-full flex flex-col items-center justify-center gap-1 disabled:opacity-50"
    style={{ backgroundColor: '#F1E9E0', color: '#6F6258', width: 70, height: 70 }}
  >
    <span className="flex items-center gap-1" aria-hidden="true">
      <span data-more-preview="awake"><EyeOpenIcon size={15} color="#6F9B78" /></span>
      <span className="h-4 w-px" style={{ backgroundColor: '#D8CEC4' }} />
      <span data-more-preview="medication"><PillIcon size={15} color="#7F96A5" /></span>
    </span>
    <span className="text-[10px] font-medium">更多</span>
  </button>
</div>
```

After More, keep the existing Poop, Feed, and Solid food blocks in that order. Remove the Awake and Medication blocks completely. Keep `tabIndex={setIdx === 1 ? 0 : -1}` and the existing fixed `140px` item dimensions on all four actions.

- [ ] **Step 6: Add the More records bottom sheet**

Render this immediately after the carousel and before `SolidFoodForm`:

```tsx
{showMoreRecords && (
  <div
    className="fixed inset-0 z-50 flex items-end justify-center"
    style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)' }}
    onClick={handleCloseMoreRecords}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="more-records-title"
      className="w-full max-w-sm rounded-t-2xl p-6 pb-8"
      style={{ backgroundColor: '#FFF9F2' }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-5 flex items-center justify-between">
        <span id="more-records-title" className="text-base font-medium" style={{ color: '#3D3229' }}>
          更多记录
        </span>
        <button type="button" aria-label="关闭更多记录" className="p-1" onClick={handleCloseMoreRecords}>
          <CloseIcon size={18} color="#BFB3A8" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleQuickAddAwake}
          disabled={submitting || Boolean(room.activeAwake)}
          className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl transition-transform active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundColor: '#EEF5EF', color: '#5F8B6A' }}
        >
          <EyeOpenIcon size={24} color="currentColor" />
          <span className="text-sm font-medium">{room.activeAwake ? '清醒中' : '清醒'}</span>
        </button>
        <button
          type="button"
          onClick={handleOpenMedicationFromMore}
          disabled={submitting}
          className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl transition-transform active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundColor: '#EEF1F3', color: '#758C9A' }}
        >
          <PillIcon size={24} color="currentColor" />
          <span className="text-sm font-medium">吃药</span>
        </button>
      </div>

      {awakeStartError && (
        <p role="alert" className="mt-3 text-center text-sm" style={{ color: '#C96F5B' }}>
          {awakeStartError}
        </p>
      )}
    </div>
  </div>
)}
```

Do not add `autoFocus` or a programmatic `focus()` call.

- [ ] **Step 7: Replace the passive awake duration label with a direct action strip**

Replace the existing `Active awake duration` block with:

```tsx
{room.activeAwake && (
  <div className="px-5 pb-4">
    <button
      type="button"
      aria-label={`已清醒${awakeDuration}，记为睡了`}
      onClick={handleEndAwake}
      disabled={submitting}
      className="flex min-h-12 w-full items-center gap-2 rounded-xl px-4 text-left transition-transform active:scale-[0.98] disabled:opacity-50"
      style={{ backgroundColor: '#EEF5EF', color: '#5F8B6A' }}
    >
      <EyeOpenIcon size={18} color="currentColor" />
      <span className="text-sm">已清醒 {awakeDuration}</span>
      <span className="ml-auto text-sm font-medium">睡了</span>
    </button>
  </div>
)}
```

Use one button for the whole strip so there are no nested interactive controls.

- [ ] **Step 8: Run the focused tests and fix only contract mismatches**

Run:

```bash
pnpm exec tsx --test tests/action-carousel.test.ts tests/low-frequency-record-entry.test.ts
pnpm run ts-check
pnpm run lint:build
```

Expected: all tests pass and both static checks exit 0. If the source contract test fails because formatting differs, update the regex only when the rendered semantics still match the specification.

- [ ] **Step 9: Commit the low-frequency entry UI**

```bash
git add src/app/page.tsx tests/low-frequency-record-entry.test.ts
git commit -m "feat: group low-frequency record actions"
```

### Task 3: Full Regression And Rendered QA

**Files:**
- Verify: `src/app/page.tsx`
- Verify: `src/lib/action-carousel.ts`
- Verify: `tests/action-carousel.test.ts`
- Verify: `tests/low-frequency-record-entry.test.ts`

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
pnpm test
pnpm run validate
pnpm run build
```

Expected: every command exits 0. The test output contains no failures, TypeScript and ESLint report no errors, and Next.js completes a production build.

- [ ] **Step 2: Start the development server**

Run:

```bash
pnpm run dev
```

Expected: the app becomes available at `http://localhost:5000` without a framework startup error. Keep the process running for browser checks.

- [ ] **Step 3: Verify the mobile flow at 390×844**

Use the available in-app Browser plugin and keep one tab bound to `http://localhost:5000`.

The flow under test is: room home → More carousel action → More records sheet → start awake or open medication → expected home or medication state.

Verify:

- Page URL and title identify the baby-feed app.
- The first meaningful screen is not blank and has no framework error overlay.
- The middle carousel set reads More, Poop, Feed, Solid food in order and Feed is initially centered.
- The More button visibly contains both awake and medication preview icons.
- Opening More does not focus an input or summon the phone keyboard.
- Starting awake closes More and shows the active-awake strip.
- Clicking the active-awake strip opens the existing awake confirmation sheet.
- Opening medication from More closes the first sheet and leaves exactly one overlay.
- Console warnings and errors contain no relevant application failures.
- A screenshot proves the default home state; another proves the More sheet or active-awake state.

- [ ] **Step 4: Verify desktop layout**

At a desktop viewport of at least 1280×800, reload the same app and verify the carousel remains usable, the More sheet is constrained to `max-w-sm`, and no text, icons, or overlays overlap.

- [ ] **Step 5: Inspect the final diff and repository state**

Run:

```bash
git diff HEAD~2 --check
git status --short
```

Expected: `git diff --check` exits 0. Only the pre-existing `.superpowers/` path may remain untracked; no screenshots, traces, temporary browser scripts, databases, or build artifacts are staged.
