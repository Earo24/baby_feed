# Solid Food Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared, single-hand solid-food logging with optional quantity/unit, today and history display, and deletion without changing milk statistics.

**Architecture:** Keep solid food as an independent SQLite record type with its own repository functions and API routes. Put shared types, unit labels, formatting, and input normalization in a browser-safe domain module; keep the bottom-sheet form and record row in one focused client component file; let the existing page coordinate fetching and mixed timelines.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, SQLite with better-sqlite3, Tailwind CSS 4, shadcn Select, lucide-react, Node built-in test runner through the existing tsx dependency.

---

## File Map

- Create `src/lib/solid-food.ts`: shared solid-food types, units, validation, and amount formatting.
- Create `src/components/solid-food.tsx`: bottom-sheet form and reusable timeline row.
- Create `src/app/api/rooms/[id]/solid-foods/route.ts`: create and range-query solid-food records.
- Create `src/app/api/solid-foods/[solidFoodId]/route.ts`: delete a solid-food record.
- Modify `src/storage/database/sqlite.ts`: schema, row type, repository reads/writes, and controlled deletion support.
- Modify `src/app/api/rooms/[id]/route.ts`: include current-cycle solid-food records in room data.
- Modify `src/app/page.tsx`: action entry, form coordination, today stats, mixed timelines, history loading, and deletion.
- Modify `package.json`: expose the Node/tsx test command without adding a dependency.
- Create `tests/solid-food-domain.test.ts`: domain validation and formatting coverage.
- Create `tests/solid-food-storage.test.ts`: temporary-SQLite repository coverage.
- Create `tests/solid-food-api.test.ts`: route validation, room payload, querying, deletion, and milk-isolation coverage.
- Create `tests/solid-food-components.test.ts`: server-rendered record-row contract coverage.

### Task 1: Define the Solid-Food Domain Contract

**Files:**
- Create: `src/lib/solid-food.ts`
- Create: `tests/solid-food-domain.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the test command and failing domain tests**

Add this script to `package.json`:

```json
"test": "tsx --test tests/*.test.ts"
```

Create `tests/solid-food-domain.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSolidFoodAmount, normalizeSolidFoodInput } from '../src/lib/solid-food';

test('normalizes a complete solid-food input', () => {
  const result = normalizeSolidFoodInput({
    food_name: '  米糊  ',
    amount_value: '0.5',
    amount_unit: 'bowl',
    recorder_name: ' 妈妈 ',
    note: ' 第一次尝试 ',
    started_at: '2026-08-25T04:30:00.000Z',
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      food_name: '米糊',
      amount_value: 0.5,
      amount_unit: 'bowl',
      recorder_name: '妈妈',
      note: '第一次尝试',
      started_at: '2026-08-25T04:30:00.000Z',
    },
  });
});

test('allows a name-only record and drops a unit without an amount', () => {
  const result = normalizeSolidFoodInput({ food_name: '香蕉', amount_unit: 'g' });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.amount_value, null);
    assert.equal(result.data.amount_unit, null);
  }
});

test('rejects blank names, non-positive amounts, invalid units, and invalid dates', () => {
  assert.deepEqual(normalizeSolidFoodInput({ food_name: ' ' }), { success: false, error: '请输入食物名称' });
  assert.deepEqual(normalizeSolidFoodInput({ food_name: '米糊', amount_value: 0 }), { success: false, error: '食用量必须大于 0' });
  assert.deepEqual(normalizeSolidFoodInput({ food_name: '米糊', amount_value: 2, amount_unit: 'cup' }), { success: false, error: '无效的食用量单位' });
  assert.deepEqual(normalizeSolidFoodInput({ food_name: '米糊', started_at: 'not-a-date' }), { success: false, error: '无效的记录时间' });
});

test('formats known and unitless amounts', () => {
  assert.equal(formatSolidFoodAmount(30, 'g'), '30克');
  assert.equal(formatSolidFoodAmount(0.5, 'bowl'), '0.5碗');
  assert.equal(formatSolidFoodAmount(2, null), '2');
  assert.equal(formatSolidFoodAmount(null, 'ml'), '');
});
```

- [ ] **Step 2: Run the domain tests and verify the missing-module failure**

Run: `pnpm test`

Expected: FAIL because `src/lib/solid-food.ts` does not exist.

- [ ] **Step 3: Implement the shared domain module**

Create `src/lib/solid-food.ts`:

```ts
export const SOLID_FOOD_UNIT_OPTIONS = [
  { value: 'g', label: '克' },
  { value: 'ml', label: '毫升' },
  { value: 'spoon', label: '勺' },
  { value: 'bowl', label: '碗' },
  { value: 'none', label: '无单位' },
] as const;

export type SolidFoodUnit = Exclude<(typeof SOLID_FOOD_UNIT_OPTIONS)[number]['value'], 'none'>;

export interface SolidFoodRecord {
  id: string;
  recorder_name: string | null;
  food_name: string;
  amount_value: number | null;
  amount_unit: SolidFoodUnit | null;
  note: string | null;
  started_at: string;
  created_at: string;
}

export interface NormalizedSolidFoodInput {
  recorder_name: string | null;
  food_name: string;
  amount_value: number | null;
  amount_unit: SolidFoodUnit | null;
  note: string | null;
  started_at: string;
}

export type SolidFoodInputResult =
  | { success: true; data: NormalizedSolidFoodInput }
  | { success: false; error: string };

const UNIT_LABELS: Record<SolidFoodUnit, string> = {
  g: '克',
  ml: '毫升',
  spoon: '勺',
  bowl: '碗',
};

const VALID_UNITS = new Set<SolidFoodUnit>(['g', 'ml', 'spoon', 'bowl']);

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

export function normalizeSolidFoodInput(input: unknown): SolidFoodInputResult {
  const source = typeof input === 'object' && input !== null
    ? input as Record<string, unknown>
    : {};
  const foodName = optionalTrimmedString(source.food_name);
  if (!foodName) return { success: false, error: '请输入食物名称' };

  const rawAmount = source.amount_value;
  let amountValue: number | null = null;
  if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
    amountValue = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return { success: false, error: '食用量必须大于 0' };
    }
  }

  let amountUnit: SolidFoodUnit | null = null;
  if (amountValue !== null && source.amount_unit !== undefined && source.amount_unit !== null && source.amount_unit !== '' && source.amount_unit !== 'none') {
    if (typeof source.amount_unit !== 'string' || !VALID_UNITS.has(source.amount_unit as SolidFoodUnit)) {
      return { success: false, error: '无效的食用量单位' };
    }
    amountUnit = source.amount_unit as SolidFoodUnit;
  }

  const rawStartedAt = source.started_at;
  const startedAt = rawStartedAt === undefined || rawStartedAt === null || rawStartedAt === ''
    ? new Date().toISOString()
    : String(rawStartedAt);
  if (Number.isNaN(Date.parse(startedAt))) {
    return { success: false, error: '无效的记录时间' };
  }

  return {
    success: true,
    data: {
      food_name: foodName,
      amount_value: amountValue,
      amount_unit: amountUnit,
      recorder_name: optionalTrimmedString(source.recorder_name),
      note: optionalTrimmedString(source.note),
      started_at: new Date(startedAt).toISOString(),
    },
  };
}

export function formatSolidFoodAmount(value: number | null, unit: SolidFoodUnit | null): string {
  if (value === null) return '';
  return `${value}${unit ? UNIT_LABELS[unit] : ''}`;
}
```

- [ ] **Step 4: Run the domain tests**

Run: `pnpm test`

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the domain contract**

```bash
git add package.json src/lib/solid-food.ts tests/solid-food-domain.test.ts
git commit -m "feat: define solid food record contract"
```

### Task 2: Add SQLite Persistence

**Files:**
- Modify: `src/storage/database/sqlite.ts`
- Create: `tests/solid-food-storage.test.ts`

- [ ] **Step 1: Write the failing repository test**

Create `tests/solid-food-storage.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import {
  deleteById,
  getDatabase,
  getLastFeed,
  getSolidFoods,
  insertRoom,
  insertSolidFood,
} from '../src/storage/database/sqlite';

let temporaryDirectory = '';

before(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'baby-feed-solid-food-storage-'));
  process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');
});

after(() => {
  getDatabase().close();
  globalThis.__babyFeedSqlite = undefined;
  delete process.env.SQLITE_PATH;
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('stores, queries, and deletes a solid-food record without creating a last feed', () => {
  const room = insertRoom({ code: 'SOLID1', name: '测试宝宝' });
  const created = insertSolidFood({
    room_id: room.id,
    recorder_name: '妈妈',
    food_name: '米糊',
    amount_value: 0.5,
    amount_unit: 'bowl',
    note: null,
    started_at: '2026-08-25T04:30:00.000Z',
  });

  assert.equal(created.food_name, '米糊');
  assert.equal(created.amount_value, 0.5);
  assert.deepEqual(getSolidFoods(room.id), [created]);
  assert.equal(getLastFeed(room.id), undefined);

  deleteById('solid_food_records', created.id);
  assert.deepEqual(getSolidFoods(room.id), []);
});
```

- [ ] **Step 2: Run the storage test and verify missing exports**

Run: `pnpm test`

Expected: FAIL because `getSolidFoods` and `insertSolidFood` are not exported.

- [ ] **Step 3: Add the row type and schema**

Add the import and row type near the existing row interfaces in `src/storage/database/sqlite.ts`:

```ts
import type { SolidFoodUnit } from '@/lib/solid-food';

export interface SolidFoodRow {
  id: string;
  room_id: string;
  recorder_name: string | null;
  food_name: string;
  amount_value: number | null;
  amount_unit: SolidFoodUnit | null;
  note: string | null;
  started_at: string;
  created_at: string;
}
```

Add this table and index inside `initializeDatabase`:

```sql
CREATE TABLE IF NOT EXISTS solid_food_records (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  recorder_name TEXT,
  food_name TEXT NOT NULL,
  amount_value REAL,
  amount_unit TEXT,
  note TEXT,
  started_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS solid_food_records_room_started_idx
  ON solid_food_records(room_id, started_at);
```

- [ ] **Step 4: Add repository operations and controlled deletion**

Extend `deleteById` and `getTimedRows`, then add the public read/insert functions:

```ts
type TimedRecordTable = 'poop_records' | 'medication_records' | 'awake_records' | 'solid_food_records';

export function deleteById(
  table: 'feed_records' | TimedRecordTable,
  id: string,
): void {
  getDatabase().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

function getTimedRows<T>(table: TimedRecordTable, roomId: string, startIso?: string): T[] {
  const db = getDatabase();
  const query = startIso
    ? `SELECT * FROM ${table} WHERE room_id = ? AND started_at >= ? ORDER BY started_at DESC`
    : `SELECT * FROM ${table} WHERE room_id = ? ORDER BY started_at DESC`;
  return (startIso ? db.prepare(query).all(roomId, startIso) : db.prepare(query).all(roomId)) as T[];
}

export function getSolidFoods(roomId: string, startIso?: string): SolidFoodRow[] {
  return getTimedRows<SolidFoodRow>('solid_food_records', roomId, startIso);
}

export function insertSolidFood(input: Omit<SolidFoodRow, 'id' | 'created_at'>): SolidFoodRow {
  const row: SolidFoodRow = { ...input, id: createId(), created_at: nowIso() };
  getDatabase().prepare(`INSERT INTO solid_food_records
    (id, room_id, recorder_name, food_name, amount_value, amount_unit, note, started_at, created_at)
    VALUES (@id, @room_id, @recorder_name, @food_name, @amount_value, @amount_unit, @note, @started_at, @created_at)`).run(row);
  return row;
}
```

Keep the existing `getPoops`, `getMedications`, and `getAwakes` functions, changing only their shared table type through `TimedRecordTable`.

- [ ] **Step 5: Run repository and domain tests**

Run: `pnpm test`

Expected: 5 tests PASS and the temporary SQLite directory is removed after the run.

- [ ] **Step 6: Commit persistence**

```bash
git add src/storage/database/sqlite.ts tests/solid-food-storage.test.ts
git commit -m "feat: persist solid food records"
```

### Task 3: Add Solid-Food HTTP APIs and Room Data

**Files:**
- Create: `src/app/api/rooms/[id]/solid-foods/route.ts`
- Create: `src/app/api/solid-foods/[solidFoodId]/route.ts`
- Modify: `src/app/api/rooms/[id]/route.ts`
- Create: `tests/solid-food-api.test.ts`

- [ ] **Step 1: Write the failing route integration test**

Create `tests/solid-food-api.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { NextRequest } from 'next/server';
import { DELETE as deleteSolidFood } from '../src/app/api/solid-foods/[solidFoodId]/route';
import { GET as getRoom } from '../src/app/api/rooms/[id]/route';
import { GET as getSolidFoods, POST as postSolidFood } from '../src/app/api/rooms/[id]/solid-foods/route';
import { getDatabase, insertFeed, insertRoom } from '../src/storage/database/sqlite';

let temporaryDirectory = '';
let roomId = '';
let lastFeedId = '';

before(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'baby-feed-solid-food-api-'));
  process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');
  const room = insertRoom({ code: 'SOLID2', name: '接口宝宝' });
  roomId = room.id;
  lastFeedId = insertFeed({
    room_id: room.id,
    feeder_name: '爸爸',
    feed_type: 'formula',
    duration_minutes: null,
    amount_ml: 120,
    note: null,
    started_at: new Date().toISOString(),
  }).id;
});

after(() => {
  getDatabase().close();
  globalThis.__babyFeedSqlite = undefined;
  delete process.env.SQLITE_PATH;
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('validates, creates, queries, exposes, and deletes a solid-food record', async () => {
  const invalidResponse = await postSolidFood(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food_name: ' ', amount_value: 1 }),
    }),
    { params: Promise.resolve({ id: roomId }) },
  );
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { success: false, error: '请输入食物名称' });

  const createResponse = await postSolidFood(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        food_name: '米糊',
        amount_value: 0.5,
        amount_unit: 'bowl',
        recorder_name: '妈妈',
        started_at: new Date().toISOString(),
      }),
    }),
    { params: Promise.resolve({ id: roomId }) },
  );
  assert.equal(createResponse.status, 200);
  const createPayload = await createResponse.json();
  assert.equal(createPayload.success, true);
  assert.equal(createPayload.data.food_name, '米糊');

  const listResponse = await getSolidFoods(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods?days=7`),
    { params: Promise.resolve({ id: roomId }) },
  );
  const listPayload = await listResponse.json();
  assert.equal(listPayload.data.length, 1);

  const roomResponse = await getRoom(
    new NextRequest(`http://localhost/api/rooms/${roomId}`),
    { params: Promise.resolve({ id: roomId }) },
  );
  const roomPayload = await roomResponse.json();
  assert.equal(roomPayload.data.solid_foods.length, 1);
  assert.equal(roomPayload.data.lastFeed.id, lastFeedId);
  assert.equal(roomPayload.data.feeds.length, 1);

  const deleteResponse = await deleteSolidFood(
    new NextRequest(`http://localhost/api/solid-foods/${createPayload.data.id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ solidFoodId: createPayload.data.id }) },
  );
  assert.deepEqual(await deleteResponse.json(), { success: true });

  const emptyResponse = await getSolidFoods(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods?days=7`),
    { params: Promise.resolve({ id: roomId }) },
  );
  assert.deepEqual((await emptyResponse.json()).data, []);
});
```

- [ ] **Step 2: Run the tests and verify route-module failures**

Run: `pnpm test`

Expected: FAIL because both solid-food route files are absent.

- [ ] **Step 3: Implement the room-scoped collection route**

Create `src/app/api/rooms/[id]/solid-foods/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { normalizeSolidFoodInput } from '@/lib/solid-food';
import { getRoomById, getSolidFoods, insertSolidFood } from '@/storage/database/sqlite';
import { getChinaCycleStart } from '@/storage/database/time';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    if (!getRoomById(roomId)) {
      return NextResponse.json({ success: false, error: '房间不存在' }, { status: 404 });
    }

    const normalized = normalizeSolidFoodInput(await request.json());
    if (!normalized.success) {
      return NextResponse.json(normalized, { status: 400 });
    }

    const data = insertSolidFood({ room_id: roomId, ...normalized.data });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : '添加辅食记录失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: roomId } = await params;
    const parsedDays = Number.parseInt(new URL(request.url).searchParams.get('days') || '1', 10);
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 30) : 1;
    return NextResponse.json({
      success: true,
      data: getSolidFoods(roomId, getChinaCycleStart(days)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取辅食记录失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Implement deletion**

Create `src/app/api/solid-foods/[solidFoodId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { deleteById } from '@/storage/database/sqlite';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ solidFoodId: string }> },
) {
  try {
    deleteById('solid_food_records', (await params).solidFoodId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除辅食记录失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 5: Add solid food to the room response**

Update the import in `src/app/api/rooms/[id]/route.ts` to include `getSolidFoods`, then add the payload field immediately after `poops`:

```ts
import {
  getActiveAwake,
  getAwakes,
  getFeeds,
  getLastFeed,
  getMedications,
  getPoops,
  getRoomById,
  getSolidFoods,
} from '@/storage/database/sqlite';

// Inside data:
solid_foods: getSolidFoods(id, dayStartISO).slice(0, 50),
```

- [ ] **Step 6: Run all API and repository tests**

Run: `pnpm test`

Expected: 6 tests PASS, including preserved `lastFeed` and feed count after a solid-food create.

- [ ] **Step 7: Commit the API slice**

```bash
git add src/app/api/rooms/[id]/solid-foods/route.ts src/app/api/solid-foods/[solidFoodId]/route.ts src/app/api/rooms/[id]/route.ts tests/solid-food-api.test.ts
git commit -m "feat: expose solid food record APIs"
```

### Task 4: Build the Reusable Solid-Food UI

**Files:**
- Create: `src/components/solid-food.tsx`
- Create: `tests/solid-food-components.test.ts`

- [ ] **Step 1: Confirm the installed Select API**

Run: `pnpm dlx shadcn@latest docs select`

Expected: the CLI prints the Select documentation URLs. If the locally observed `@modelcontextprotocol/sdk` and Zod export error recurs, record that exact failure and use the already-installed `src/components/ui/select.tsx` exports: `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, and `SelectValue`.

- [ ] **Step 2: Write the failing record-row render test**

Create `tests/solid-food-components.test.ts` without JSX so it remains covered by the existing test glob:

```ts
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { SolidFoodRecordRow } from '../src/components/solid-food';

test('renders the food, formatted amount, note, recorder, and time', () => {
  const markup = renderToStaticMarkup(createElement(SolidFoodRecordRow, {
    record: {
      id: 'solid-1',
      recorder_name: '妈妈',
      food_name: '米糊',
      amount_value: 0.5,
      amount_unit: 'bowl',
      note: '第一次尝试',
      started_at: '2026-08-25T04:30:00.000Z',
      created_at: '2026-08-25T04:31:00.000Z',
    },
  }));

  assert.match(markup, /米糊/);
  assert.match(markup, /0.5碗/);
  assert.match(markup, /第一次尝试/);
  assert.match(markup, /妈妈/);
});
```

- [ ] **Step 3: Run the component test and verify the missing-component failure**

Run: `pnpm test`

Expected: FAIL because `src/components/solid-food.tsx` does not exist.

- [ ] **Step 4: Implement the form and record row**

Create `src/components/solid-food.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { Utensils, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  formatSolidFoodAmount,
  normalizeSolidFoodInput,
  SOLID_FOOD_UNIT_OPTIONS,
  type NormalizedSolidFoodInput,
  type SolidFoodRecord,
} from '@/lib/solid-food';

const SOLID_FOOD_COLOR = '#6F9B78';

function currentTimeValue(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function SolidFoodRecordRow({ record }: { record: SolidFoodRecord }) {
  const amount = formatSolidFoodAmount(record.amount_value, record.amount_unit);
  const time = new Date(record.started_at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex min-h-12 items-center gap-3 px-4 py-3" style={{ backgroundColor: '#FFFCF8' }}>
      <div className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: SOLID_FOOD_COLOR }} />
      <Utensils className="size-4 shrink-0" aria-hidden="true" style={{ color: SOLID_FOOD_COLOR }} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="max-w-full truncate text-base" style={{ color: '#3D3229' }}>{record.food_name}</span>
          {amount ? <span className="text-sm tabular-nums" style={{ color: '#6F9B78' }}>{amount}</span> : null}
          {record.recorder_name ? <span className="text-sm" style={{ color: '#BFB3A8' }}>{record.recorder_name}</span> : null}
        </div>
        {record.note ? <p className="truncate text-xs" style={{ color: '#A89888' }}>{record.note}</p> : null}
      </div>
      <span className="shrink-0 text-sm tabular-nums" style={{ color: '#BFB3A8' }}>{time}</span>
    </div>
  );
}

interface SolidFoodFormProps {
  recorderName: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: NormalizedSolidFoodInput) => Promise<{ success: boolean; error?: string }>;
}

export function SolidFoodForm({ recorderName, submitting, onClose, onSubmit }: SolidFoodFormProps) {
  const [foodName, setFoodName] = useState('');
  const [amountValue, setAmountValue] = useState('');
  const [amountUnit, setAmountUnit] = useState('g');
  const [time, setTime] = useState(currentTimeValue);
  const [usePreviousDay, setUsePreviousDay] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const now = new Date();
    const [hours, minutes] = time.split(':').map(Number);
    const startedAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + (usePreviousDay ? -1 : 0),
      hours,
      minutes,
    );
    const normalized = normalizeSolidFoodInput({
      food_name: foodName,
      amount_value: amountValue,
      amount_unit: amountUnit,
      recorder_name: recorderName,
      note,
      started_at: startedAt.toISOString(),
    });
    if (!normalized.success) {
      setError(normalized.error);
      return;
    }

    setError('');
    const result = await onSubmit(normalized.data);
    if (result.success) onClose();
    else setError(result.error || '保存失败，请重试');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="presentation"
      style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
      onClick={() => { if (!submitting) onClose(); }}
    >
      <form
        aria-label="记录辅食"
        aria-modal="true"
        className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5"
        role="dialog"
        style={{ backgroundColor: '#FFF9F2' }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Utensils className="size-5" aria-hidden="true" style={{ color: SOLID_FOOD_COLOR }} />
            <h2 className="text-base font-medium" style={{ color: '#3D3229' }}>记录辅食</h2>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="flex size-10 items-center justify-center rounded-lg"
            disabled={submitting}
            onClick={onClose}
          >
            <X className="size-5" aria-hidden="true" style={{ color: '#A89888' }} />
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-sm" style={{ color: '#8B7E74' }}>
          食物名称
          <input
            autoFocus
            className="h-12 rounded-lg border px-3 text-base outline-none"
            maxLength={80}
            placeholder="例如：米糊"
            style={{ backgroundColor: '#FFFCF8', borderColor: '#EDE5DC', color: '#3D3229' }}
            value={foodName}
            onChange={(event) => setFoodName(event.target.value)}
          />
        </label>

        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm" style={{ color: '#8B7E74' }}>
            食用量
            <input
              className="h-12 min-w-0 rounded-lg border px-3 text-base outline-none"
              inputMode="decimal"
              min="0"
              placeholder="可不填"
              step="any"
              style={{ backgroundColor: '#FFFCF8', borderColor: '#EDE5DC', color: '#3D3229' }}
              type="number"
              value={amountValue}
              onChange={(event) => setAmountValue(event.target.value)}
            />
          </label>
          <div className="flex min-w-0 flex-col gap-1.5 text-sm" style={{ color: '#8B7E74' }}>
            <span>单位</span>
            <Select value={amountUnit} onValueChange={setAmountUnit}>
              <SelectTrigger className="h-12 w-full shadow-none" style={{ backgroundColor: '#FFFCF8', borderColor: '#EDE5DC', color: '#3D3229' }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOLID_FOOD_UNIT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm" style={{ color: '#8B7E74' }}>时间</span>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <div className="flex rounded-lg p-1" style={{ backgroundColor: '#F3ECE4' }}>
              {[{ label: '今天', value: false }, { label: '昨天', value: true }].map((option) => (
                <button
                  key={option.label}
                  className="min-h-10 rounded-md px-3 text-sm"
                  style={{
                    backgroundColor: usePreviousDay === option.value ? '#FFFCF8' : 'transparent',
                    color: usePreviousDay === option.value ? '#3D3229' : '#A89888',
                  }}
                  type="button"
                  onClick={() => setUsePreviousDay(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              className="h-12 min-w-0 rounded-lg border px-3 text-base outline-none"
              style={{ backgroundColor: '#FFFCF8', borderColor: '#EDE5DC', color: '#3D3229' }}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-sm" style={{ color: '#8B7E74' }}>
          备注
          <textarea
            className="min-h-20 resize-none rounded-lg border px-3 py-2 text-base outline-none"
            maxLength={200}
            placeholder="可不填"
            style={{ backgroundColor: '#FFFCF8', borderColor: '#EDE5DC', color: '#3D3229' }}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        {error ? <p role="alert" className="text-sm" style={{ color: '#E8836B' }}>{error}</p> : null}

        <button
          className="min-h-12 w-full rounded-lg text-base font-medium text-white disabled:opacity-50"
          disabled={submitting}
          style={{ backgroundColor: SOLID_FOOD_COLOR }}
          type="submit"
        >
          {submitting ? '保存中' : '确认'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Run the component/domain tests and type check**

Run: `pnpm test && pnpm run ts-check`

Expected: 7 tests PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit the reusable UI**

```bash
git add src/components/solid-food.tsx tests/solid-food-components.test.ts
git commit -m "feat: add solid food entry components"
```

### Task 5: Integrate Solid Food into the Home Experience

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add imports, room data, and state**

Add these imports after the React import:

```ts
import { Utensils } from 'lucide-react';
import { SolidFoodForm, SolidFoodRecordRow } from '@/components/solid-food';
import type { NormalizedSolidFoodInput, SolidFoodRecord } from '@/lib/solid-food';
```

Add `solid_foods: SolidFoodRecord[];` to `RoomData`. Add these states beside the other record states:

```ts
const [showSolidFoodForm, setShowSolidFoodForm] = useState(false);
const [historySolidFoods, setHistorySolidFoods] = useState<SolidFoodRecord[]>([]);
```

- [ ] **Step 2: Update the action-ring geometry and add handlers**

Change `const oneSet = itemWidth * 4;` to:

```ts
const oneSet = itemWidth * 5;
```

Add these handlers before the medication handlers:

```ts
const handleQuickAddSolidFood = () => {
  if (!room || submitting) return;
  if (feederName) localStorage.setItem('feederName', feederName);
  setShowSolidFoodForm(true);
};

const handleSubmitSolidFood = async (input: NormalizedSolidFoodInput) => {
  if (!room) return { success: false, error: '房间不存在' };
  setSubmitting(true);
  try {
    const response = await fetch(`/api/rooms/${room.id}/solid-foods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const payload = await response.json();
    if (!payload.success) return { success: false, error: payload.error || '保存失败，请重试' };
    await fetchRoom(room.id);
    return { success: true };
  } catch {
    return { success: false, error: '网络异常，请重试' };
  } finally {
    setSubmitting(false);
  }
};

const loadSolidFoodHistory = async (days: number) => {
  if (!room) return;
  const response = await fetch(`/api/rooms/${room.id}/solid-foods?days=${days}`);
  const payload = await response.json();
  if (payload.success) setHistorySolidFoods(payload.data);
};

const handleDeleteSolidFood = async (solidFoodId: string) => {
  if (!room) return;
  try {
    const response = await fetch(`/api/solid-foods/${solidFoodId}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!payload.success) throw new Error(payload.error || '删除失败');
    await Promise.all([
      fetchRoom(room.id),
      showHistory ? loadSolidFoodHistory(historyDays) : Promise.resolve(),
    ]);
  } catch {
    await Promise.allSettled([
      fetchRoom(room.id),
      showHistory ? loadSolidFoodHistory(historyDays) : Promise.resolve(),
    ]);
  }
};
```

- [ ] **Step 3: Fetch solid food with every history range**

In both `handleOpenHistory` and `handleHistoryDaysChange`, add the solid-food request to the existing `Promise.all`, parse its JSON, and update state:

```ts
const [feedRes, poopRes, medRes, awakeRes, solidFoodRes] = await Promise.all([
  fetch(`/api/rooms/${room.id}/feeds?days=${days}`),
  fetch(`/api/rooms/${room.id}/poops?days=${days}`),
  fetch(`/api/rooms/${room.id}/medications?days=${days}`),
  fetch(`/api/rooms/${room.id}/awakes?days=${days}`),
  fetch(`/api/rooms/${room.id}/solid-foods?days=${days}`),
]);
const [feedJson, poopJson, medJson, awakeJson, solidFoodJson] = await Promise.all([
  feedRes.json(),
  poopRes.json(),
  medRes.json(),
  awakeRes.json(),
  solidFoodRes.json(),
]);
if (feedJson.success) setHistoryFeeds(feedJson.data);
if (poopJson.success) setHistoryPoops(poopJson.data);
if (medJson.success) setHistoryMedications(medJson.data);
if (awakeJson.success) setHistoryAwakes(awakeJson.data);
if (solidFoodJson.success) setHistorySolidFoods(solidFoodJson.data);
```

For `handleOpenHistory`, define `const days = historyDays;` before this block. For `handleHistoryDaysChange`, use its `days` argument.

- [ ] **Step 4: Add the fifth quick-action button and form**

Insert this action inside each repeated `Fragment`, between Feed and Medication:

```tsx
<div data-btn-type="solid-food" className="snap-center flex shrink-0 items-center justify-center" style={{ width: 140, height: 140 }}>
  <button
    className="flex flex-col items-center justify-center gap-1 rounded-full text-white disabled:opacity-50"
    disabled={submitting}
    style={{ backgroundColor: '#6F9B78', width: 70, height: 70 }}
    onClick={() => { haptic('medium'); handleQuickAddSolidFood(); }}
  >
    <Utensils aria-hidden="true" size={16} />
    <span className="text-[10px]">辅食</span>
  </button>
</div>
```

Render the form once, outside the repeated action button markup:

```tsx
{showSolidFoodForm ? (
  <SolidFoodForm
    recorderName={feederName}
    submitting={submitting}
    onClose={() => setShowSolidFoodForm(false)}
    onSubmit={handleSubmitSolidFood}
  />
) : null}
```

- [ ] **Step 5: Add today summary and timeline data**

Add:

```ts
const todaySolidFoodCount = room.solid_foods?.length || 0;
```

Include `todaySolidFoodCount > 0` in the today-summary visibility condition. Change the summary container to `flex flex-wrap items-center justify-center gap-x-6 gap-y-2`, then add:

```tsx
{todaySolidFoodCount > 0 ? (
  <>
    <div className="h-4 w-px" style={{ backgroundColor: '#EDE5DC' }} />
    <div className="flex items-baseline gap-1">
      <span className="text-sm" style={{ color: '#A89888' }}>辅食</span>
      <span className="text-xl font-semibold tabular-nums" style={{ color: '#6F9B78' }}>{todaySolidFoodCount}</span>
      <span className="text-sm" style={{ color: '#A89888' }}>次</span>
    </div>
  </>
) : null}
```

In the Today Records block, add the mapped records and include them in `allItems`:

```ts
const solidFoodItems = (room.solid_foods || []).map(item => ({ ...item, _type: 'solid-food' as const }));
const allItems = [...feedItems, ...poopItems, ...medItems, ...awakeItems, ...solidFoodItems]
  .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
```

Add this render branch before the final Awake branch:

```tsx
) : item._type === 'solid-food' ? (
  <SwipeToDelete key={item.id} onDelete={() => { haptic('medium'); handleDeleteSolidFood(item.id); }}>
    <SolidFoodRecordRow record={item} />
  </SwipeToDelete>
```

- [ ] **Step 6: Add history timeline data, day stats, and rows**

Include `historySolidFoods.length === 0` in the history empty-state condition. Extend the local `CombinedItem` union and item list:

```ts
type CombinedItem =
  | (FeedRecord & { _type: 'feed' })
  | (PoopRecord & { _type: 'poop' })
  | (MedicationRecord & { _type: 'med' })
  | (AwakeRecord & { _type: 'awake' })
  | (SolidFoodRecord & { _type: 'solid-food' });

const allItems: CombinedItem[] = [
  ...historyFeeds.map(item => ({ ...item, _type: 'feed' as const })),
  ...historyPoops.map(item => ({ ...item, _type: 'poop' as const })),
  ...historyMedications.map(item => ({ ...item, _type: 'med' as const })),
  ...historyAwakes.map(item => ({ ...item, _type: 'awake' as const })),
  ...historySolidFoods.map(item => ({ ...item, _type: 'solid-food' as const })),
].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
```

Inside each day group, add:

```ts
const solidFoodItems = items.filter(item => item._type === 'solid-food');
const stats = `${feedItems.length}次 ${totalMl}ml${poopItems.length > 0 ? ` ${poopItems.length}便` : ''}${medItems.length > 0 ? ` ${medItems.length}药` : ''}${solidFoodItems.length > 0 ? ` ${solidFoodItems.length}辅` : ''}${awakeStr ? ` ${awakeStr}醒` : ''}`;
```

Add this render branch before the final Awake branch:

```tsx
) : item._type === 'solid-food' ? (
  <SwipeToDelete key={item.id} onDelete={() => { haptic('medium'); handleDeleteSolidFood(item.id); }}>
    <SolidFoodRecordRow record={item} />
  </SwipeToDelete>
```

- [ ] **Step 7: Run all automated checks**

Run: `pnpm test && pnpm run validate`

Expected: 7 tests PASS; TypeScript and quiet ESLint both exit with code 0.

- [ ] **Step 8: Commit the integrated experience**

```bash
git add src/app/page.tsx
git commit -m "feat: integrate solid food tracking"
```

### Task 6: Production and Browser Verification

**Files:**
- Modify only files implicated by a verification failure.

- [ ] **Step 1: Run the complete automated verification**

Run:

```bash
pnpm test
pnpm run validate
pnpm run build
git diff --check
```

Expected: all tests PASS, validation exits with code 0, the Next.js/server production build succeeds, and `git diff --check` prints nothing.

- [ ] **Step 2: Start a development server on an unused port**

First run: `lsof -nP -iTCP:5000 -sTCP:LISTEN`

If it prints nothing, run `DEPLOY_RUN_PORT=5000 pnpm run dev`. If port 5000 is occupied, verify port 5001 with `lsof -nP -iTCP:5001 -sTCP:LISTEN` and then run `DEPLOY_RUN_PORT=5001 pnpm run dev`.

Expected: the chosen URL responds with the Next.js application and the server session remains running for browser checks.

- [ ] **Step 3: Load the Browser skill and declare the target flow**

Read and follow `browser:control-in-app-browser` before browser actions. Use this target-flow statement:

```text
The flow under test is: room home -> open 辅食 -> validate and submit 米糊 0.5碗 -> verify today/history -> left-swipe delete -> verify removal while milk totals and last-feed state remain unchanged.
```

- [ ] **Step 4: Verify the mobile flow at 390 x 844**

Using the Browser plugin, perform these checks in order:

1. Create or join a room and set the recorder name to `妈妈`.
2. Add one 120 ml milk record and note the displayed feed count, milk total, and last-feed state.
3. Scroll the action ring to `辅食`; confirm the five-action ring still recenters correctly.
4. Open the form and submit with an empty food name; confirm `请输入食物名称` appears and no request-created row appears.
5. Enter `米糊`, amount `0.5`, unit `碗`, note `第一次尝试`, and submit.
6. Confirm `辅食 1` is represented in today stats, the row shows `米糊`, `0.5碗`, `第一次尝试`, `妈妈`, and a time, while milk count/total and last-feed state retain their prior values.
7. Open history and confirm the same record and the day-level `1辅` statistic.
8. Swipe the row left, press the revealed delete action, and confirm it disappears from both the active history view and today data after returning.

Expected: each transition is visible, the modal retains data on validation failure, and no controls overlap, clip, or resize unexpectedly.

- [ ] **Step 5: Verify desktop rendering and runtime health**

At 1440 x 900, repeat opening the form and inspecting the today/history surfaces. Check:

- URL and title identify the intended app.
- DOM snapshot contains the meaningful app UI and no framework overlay.
- Console error/warning logs contain no relevant application issue.
- The bottom sheet is centered to its max width, text fits, focus is visible, and all controls remain reachable.
- Capture one mobile screenshot with the completed record and one desktop screenshot with the open form.

Expected: all Browser required checks pass with screenshot and interaction evidence.

- [ ] **Step 6: Re-run checks after any browser-discovered fix**

Run: `pnpm test && pnpm run validate && pnpm run build && git diff --check`

Expected: the complete suite remains green after visual or interaction fixes.

- [ ] **Step 7: Commit verification fixes if present**

When verification required code changes:

```bash
git add src tests package.json
git commit -m "fix: polish solid food record flow"
```

If verification required no code changes, do not create an empty commit.

## Completion Criteria

- Solid-food records persist independently with the agreed fields and validation.
- Room polling and history ranges include solid food.
- Create, display, and delete work in the mobile-first interface.
- Milk totals, feed counts, last feed, and feed intervals are unchanged by solid food.
- Unit tests, type checking, lint, production build, mobile browser flow, desktop browser rendering, console health, and screenshots all pass.
- The development server remains available at the verified URL for user testing.
