# Solid Food Keyboard Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the solid-food drawer usable above the mobile keyboard without overlapping the form and confirmation action.

**Architecture:** Use Vaul's built-in keyboard-aware drawer behavior, keep the field group as the only scrolling region, and leave the confirmation footer outside that region. No new global viewport state or duplicated modal implementation.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Vaul, Tailwind CSS 4, Node test runner through `tsx`.

---

### Task 1: Lock the keyboard-safe layout contract

**Files:**
- Modify: `tests/solid-food-components.test.ts`

- [x] **Step 1: Write the failing contract test**

Read `src/components/solid-food.tsx` and assert the implementation exposes Vaul keyboard handling and keeps the footer outside the scroll region:

```ts
import { readFileSync } from 'node:fs';

const solidFoodSource = readFileSync(new URL('../src/components/solid-food.tsx', import.meta.url), 'utf8');

test('keeps the solid-food drawer keyboard-safe', () => {
  assert.match(solidFoodSource, /<Drawer\s+open[\s\S]*fixed\s*\n\s*repositionInputs/);
  assert.match(solidFoodSource, /FieldGroup className="[^"]*min-h-0 flex-1[^\"]*overflow-y-auto[^\"]*pb-/);
  assert.match(solidFoodSource, /<DrawerFooter className="[^"]*shrink-0/);
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec tsx --test tests/solid-food-components.test.ts`

Expected: FAIL because the current `Drawer` has no `fixed`/`repositionInputs` props and the field group has no bottom scroll buffer.

### Task 2: Apply the minimal Drawer layout fix

**Files:**
- Modify: `src/components/solid-food.tsx:183-219,218-220,385`

- [x] **Step 1: Enable Vaul keyboard handling**

Set `fixed` and `repositionInputs` on the controlled `Drawer`:

```tsx
<Drawer
  open
  fixed
  repositionInputs
  onOpenChange={(open) => {
```

- [x] **Step 2: Give the field scroller keyboard-safe breathing room**

Keep `min-h-0 flex-1 overflow-y-auto`, add a small bottom padding to the field group, and keep the footer `shrink-0` with the existing safe-area padding:

```tsx
<FieldGroup className="min-h-0 flex-1 gap-5 overflow-y-auto px-5 pb-5 pt-2">
```

The existing footer remains after the form field group:

```tsx
<DrawerFooter className="shrink-0 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
```

- [x] **Step 3: Run the focused test and verify it passes**

Run: `pnpm exec tsx --test tests/solid-food-components.test.ts`

Expected: PASS, including the existing record-row and swipe-action contracts.

### Task 3: Verify the complete change

- [ ] **Step 1: Run type and lint validation**

Run: `pnpm run validate`

Current result: blocked by pre-existing workspace issues. TypeScript reports the untracked `tests/feed-stats-api.test.ts` imports missing `src/app/api/rooms/[id]/feed-stats/route`; standalone lint also scans generated `.worktrees/milk-volume-trend/.next` files and reports their existing generated-code violations.

- [x] **Step 2: Run the production build**

Run: `pnpm run build`

Expected: Next.js production build completes successfully.

- [x] **Step 3: Recheck desktop and mobile browser layouts**

Open the local app at `http://127.0.0.1:5001/`, create a room, open 辅食, and inspect the 390px mobile viewport. Focus the name, amount, time, and note inputs; confirm each focused control remains reachable through the field scroller and the green 确认 button remains outside the scroller and visible above the keyboard. Repeat once at the desktop viewport and confirm no regressions in 吃药.

- [x] **Step 4: Review the diff**

Run: `git diff --check && git diff -- src/components/solid-food.tsx tests/solid-food-components.test.ts docs/superpowers/specs/2026-08-26-solid-food-keyboard-layout-design.md docs/superpowers/plans/2026-08-26-solid-food-keyboard-layout.md`

Expected: only the documented keyboard-layout changes are present.
