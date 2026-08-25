import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import {
  deleteById,
  getDatabase,
  getFeeds,
  getLastFeed,
  getRoomById,
  getSolidFoods,
  insertRoom,
  insertSolidFood,
} from '../src/storage/database/sqlite';

const previousSqlitePath = process.env.SQLITE_PATH;
const legacyRoom = {
  id: 'legacy-room',
  code: 'LEGACY',
  name: '旧记录宝宝',
  created_at: '2026-08-24T00:00:00.000Z',
};
const legacyFeed = {
  id: 'legacy-feed',
  room_id: legacyRoom.id,
  feeder_name: '爸爸',
  feed_type: 'bottle',
  duration_minutes: null,
  amount_ml: 120,
  note: '迁移前记录',
  started_at: '2026-08-24T04:30:00.000Z',
  created_at: '2026-08-24T04:31:00.000Z',
};

let temporaryDirectory: string;

before(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'baby-feed-solid-food-storage-'));
  process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

  const legacyDatabase = new Database(process.env.SQLITE_PATH);
  try {
    legacyDatabase.exec(`
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE feed_records (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        feeder_name TEXT,
        feed_type TEXT NOT NULL,
        duration_minutes INTEGER,
        amount_ml INTEGER,
        note TEXT,
        started_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    legacyDatabase.prepare(`INSERT INTO rooms (id, code, name, created_at)
      VALUES (@id, @code, @name, @created_at)`).run(legacyRoom);
    legacyDatabase.prepare(`INSERT INTO feed_records
      (id, room_id, feeder_name, feed_type, duration_minutes, amount_ml, note, started_at, created_at)
      VALUES (@id, @room_id, @feeder_name, @feed_type, @duration_minutes, @amount_ml, @note, @started_at, @created_at)`).run(legacyFeed);
  } finally {
    legacyDatabase.close();
  }
});

after(() => {
  try {
    globalThis.__babyFeedSqlite?.close();
  } finally {
    try {
      globalThis.__babyFeedSqlite = undefined;
    } finally {
      try {
        if (previousSqlitePath === undefined) delete process.env.SQLITE_PATH;
        else process.env.SQLITE_PATH = previousSqlitePath;
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }
});

test('migrates, stores, queries, and deletes solid-food records without creating a last feed', () => {
  assert.deepEqual(getRoomById(legacyRoom.id), legacyRoom);
  assert.deepEqual(getFeeds(legacyRoom.id), [legacyFeed]);
  assert.deepEqual(getLastFeed(legacyRoom.id), {
    id: legacyFeed.id,
    feed_type: legacyFeed.feed_type,
    started_at: legacyFeed.started_at,
    amount_ml: legacyFeed.amount_ml,
  });

  const database = getDatabase();
  assert.deepEqual(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get('solid_food_records'),
    { name: 'solid_food_records' },
  );
  const foreignKeys = database.prepare('PRAGMA foreign_key_list(solid_food_records)').all() as Array<{
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;
  assert.deepEqual(
    foreignKeys.map(({ table, from, to, on_delete }) => ({ table, from, to, on_delete })),
    [{ table: 'rooms', from: 'room_id', to: 'id', on_delete: 'CASCADE' }],
  );

  const indexes = database.prepare('PRAGMA index_list(solid_food_records)').all() as Array<{ name: string }>;
  assert.ok(indexes.some(({ name }) => name === 'solid_food_records_room_started_idx'));
  const indexedColumns = database.prepare('PRAGMA index_info(solid_food_records_room_started_idx)').all() as Array<{ name: string }>;
  assert.deepEqual(indexedColumns.map(({ name }) => name), ['room_id', 'started_at']);

  const room = insertRoom({ code: 'SOLID1', name: '测试宝宝' });
  const otherRoom = insertRoom({ code: 'SOLID2', name: '另一个宝宝' });
  const currentInput = {
    room_id: room.id,
    recorder_name: '妈妈',
    food_name: '米糊',
    amount_value: 0.5,
    amount_unit: 'bowl' as const,
    note: null,
    started_at: '2026-08-25T04:30:00.000Z',
  };

  const older = insertSolidFood({
    ...currentInput,
    food_name: '香蕉泥',
    started_at: '2026-08-25T03:30:00.000Z',
  });
  const current = insertSolidFood(currentInput);
  const newer = insertSolidFood({
    ...currentInput,
    food_name: '南瓜泥',
    started_at: '2026-08-25T05:30:00.000Z',
  });
  const otherRoomRecord = insertSolidFood({
    ...currentInput,
    room_id: otherRoom.id,
    food_name: '苹果泥',
    started_at: '2026-08-25T06:30:00.000Z',
  });

  assert.match(current.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(current, {
    ...currentInput,
    id: current.id,
    created_at: current.created_at,
  });
  assert.match(current.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(getSolidFoods(room.id), [newer, current, older]);
  assert.deepEqual(getSolidFoods(room.id, current.started_at), [newer, current]);
  assert.deepEqual(getSolidFoods(otherRoom.id), [otherRoomRecord]);
  assert.equal(getLastFeed(room.id), undefined);

  database.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
  assert.deepEqual(getSolidFoods(room.id), []);
  assert.deepEqual(getSolidFoods(otherRoom.id), [otherRoomRecord]);

  deleteById('solid_food_records', otherRoomRecord.id);
  assert.deepEqual(getSolidFoods(otherRoom.id), []);
  assert.deepEqual(getFeeds(legacyRoom.id), [legacyFeed]);
});
