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

let temporaryDirectory: string;

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

test('stores, queries, and deletes solid-food records without creating a last feed', () => {
  const room = insertRoom({ code: 'SOLID1', name: '测试宝宝' });
  const input = {
    room_id: room.id,
    recorder_name: '妈妈',
    food_name: '米糊',
    amount_value: 0.5,
    amount_unit: 'bowl' as const,
    note: null,
    started_at: '2026-08-25T04:30:00.000Z',
  };

  const created = insertSolidFood(input);

  assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(created, {
    ...input,
    id: created.id,
    created_at: created.created_at,
  });
  assert.match(created.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(getSolidFoods(room.id), [created]);
  assert.equal(getLastFeed(room.id), undefined);

  deleteById('solid_food_records', created.id);
  assert.deepEqual(getSolidFoods(room.id), []);
});
