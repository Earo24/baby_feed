# Solid Food Modal Focus Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the solid-food entry modal behave like the medication modal on mobile: opening it must not focus an input or summon the keyboard, while preserving the current dimensions and visual styling.

**Architecture:** Replace the `vaul` Drawer wrapper used only by `SolidFoodForm` with the existing page-level fixed bottom-sheet pattern used by the medication modal. Keep the existing form fields, state, validation, scrolling, spacing, colors, and submit behavior unchanged; only the modal shell and focus behavior change.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Node test runner via `tsx`, in-app Browser mobile viewport QA.

---

### Task 1: Add the regression contract

**Files:**
- Modify: `tests/solid-food-components.test.ts`
- Test: `src/components/solid-food.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that asserts the solid-food form has no `autoFocus`, no `repositionInputs`, and uses the same fixed bottom-sheet primitives as the medication modal: `fixed inset-0`, `items-end`, `rounded-t-2xl`, and an inner click-stopping panel.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm test tests/solid-food-components.test.ts`

Expected: FAIL because the current source still contains `autoFocus`, `repositionInputs`, and the `Drawer` wrapper.

### Task 2: Implement the medication-style shell

**Files:**
- Modify: `src/components/solid-food.tsx`

- [ ] **Step 1: Replace only the shell and imports**

Remove the `Drawer` imports and wrap the existing header/form/footer contents in:

```tsx
<div
  className="fixed inset-0 z-50 flex items-end justify-center"
  style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
  onClick={onClose}
>
  <div
    className="w-full max-w-md rounded-t-2xl p-0"
    style={{ backgroundColor: '#FFF9F2' }}
    onClick={(event) => event.stopPropagation()}
  >
    {/* existing header, form, and footer content */}
  </div>
</div>
```

Keep the existing `max-h-[90dvh]`, `overflow-hidden`, padding, field gaps, colors, button height, and safe-area footer classes on the corresponding inner elements. Remove the `autoFocus` prop from `solid-food-name`. Keep close-button and backdrop close behavior guarded by `submitting`.

- [ ] **Step 2: Run the focused test to verify it passes**

Run: `pnpm test tests/solid-food-components.test.ts`

Expected: PASS, including the new no-autofocus contract.

### Task 3: Run full validation and mobile browser QA

**Files:**
- No additional repository files.

- [ ] **Step 1: Run the full test and validation suites**

Run: `pnpm test` and `pnpm run validate`.

Expected: all tests pass, TypeScript and lint pass.

- [ ] **Step 2: Exercise the flow at desktop and mobile sizes**

Use the Browser runtime against the local app. Verify page identity, non-blank render, no framework overlay, console health, and screenshots at a desktop viewport and 390×844 mobile viewport. In the mobile flow, tap the 辅食 button, assert the modal is visible and the active element is not an input, then tap 食物名称 and assert that input becomes active. Close and reopen once to catch stale focus.

- [ ] **Step 3: Run the production build**

Run: `pnpm run build`.

Expected: production build completes successfully.

