import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SolidFoodUnit } from '@/lib/solid-food';

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  created_at: string;
}

export interface FeedRow {
  id: string;
  room_id: string;
  feeder_name: string | null;
  feed_type: string;
  duration_minutes: number | null;
  amount_ml: number | null;
  note: string | null;
  started_at: string;
  created_at: string;
}

export interface PoopRow {
  id: string;
  room_id: string;
  recorder_name: string | null;
  color: string | null;
  consistency: string | null;
  note: string | null;
  started_at: string;
  created_at: string;
}

export interface MedicationRow {
  id: string;
  room_id: string;
  recorder_name: string | null;
  medicine_name: string | null;
  dosage: string | null;
  note: string | null;
  started_at: string;
  created_at: string;
}

export interface AwakeRow {
  id: string;
  room_id: string;
  recorder_name: string | null;
  note: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

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

type TimedRecordTable = 'poop_records' | 'medication_records' | 'awake_records' | 'solid_food_records';

type SqliteDatabase = Database.Database;

declare global {
  // eslint-disable-next-line no-var
  var __babyFeedSqlite: SqliteDatabase | undefined;
}

function databasePath(): string {
  return process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'baby-feed.sqlite');
}

function initializeDatabase(db: SqliteDatabase): void {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feed_records (
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

    CREATE TABLE IF NOT EXISTS poop_records (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      recorder_name TEXT,
      color TEXT,
      consistency TEXT,
      note TEXT,
      started_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medication_records (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      recorder_name TEXT,
      medicine_name TEXT,
      dosage TEXT,
      note TEXT,
      started_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS awake_records (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      recorder_name TEXT,
      note TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL
    );

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

    CREATE INDEX IF NOT EXISTS feed_records_room_started_idx ON feed_records(room_id, started_at);
    CREATE INDEX IF NOT EXISTS poop_records_room_started_idx ON poop_records(room_id, started_at);
    CREATE INDEX IF NOT EXISTS medication_records_room_started_idx ON medication_records(room_id, started_at);
    CREATE INDEX IF NOT EXISTS awake_records_room_started_idx ON awake_records(room_id, started_at);
    CREATE INDEX IF NOT EXISTS solid_food_records_room_started_idx ON solid_food_records(room_id, started_at);
  `);
}

export function getDatabase(): SqliteDatabase {
  if (globalThis.__babyFeedSqlite) return globalThis.__babyFeedSqlite;
  const filePath = databasePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  initializeDatabase(db);
  globalThis.__babyFeedSqlite = db;
  return db;
}

export function checkDatabaseHealth(): void {
  const result = getDatabase().prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
  if (result?.ok !== 1) throw new Error('SQLite health check failed');
}

export function createId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getRoomById(id: string): RoomRow | undefined {
  return getDatabase().prepare('SELECT id, code, name, created_at FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
}

export function getRoomByCode(code: string): RoomRow | undefined {
  return getDatabase().prepare('SELECT id, code, name, created_at FROM rooms WHERE code = ?').get(code) as RoomRow | undefined;
}

export function insertRoom(input: { code: string; name: string }): RoomRow {
  const room: RoomRow = { id: createId(), code: input.code, name: input.name, created_at: nowIso() };
  getDatabase().prepare('INSERT INTO rooms (id, code, name, created_at) VALUES (?, ?, ?, ?)').run(room.id, room.code, room.name, room.created_at);
  return room;
}

export function getFeeds(roomId: string, startIso?: string, limit = 500): FeedRow[] {
  const db = getDatabase();
  if (startIso) {
    return db.prepare(`SELECT id, room_id, feeder_name, feed_type, duration_minutes, amount_ml, note, started_at, created_at
      FROM feed_records WHERE room_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT ?`).all(roomId, startIso, limit) as FeedRow[];
  }
  return db.prepare(`SELECT id, room_id, feeder_name, feed_type, duration_minutes, amount_ml, note, started_at, created_at
    FROM feed_records WHERE room_id = ? ORDER BY started_at DESC LIMIT ?`).all(roomId, limit) as FeedRow[];
}

export function getFeedTrendRecords(roomId: string, startIso: string): Array<Pick<FeedRow, 'started_at' | 'amount_ml'>> {
  return getDatabase().prepare(`SELECT started_at, amount_ml FROM feed_records WHERE room_id = ? AND started_at >= ? ORDER BY started_at ASC`).all(roomId, startIso) as Array<Pick<FeedRow, 'started_at' | 'amount_ml'>>;
}

export type MultiTrendRecordSets = {
  feeds: Array<Pick<FeedRow, 'started_at' | 'amount_ml'>>;
  poops: Array<Pick<PoopRow, 'started_at'>>;
  medications: Array<Pick<MedicationRow, 'started_at'>>;
  solid_foods: Array<Pick<SolidFoodRow, 'started_at'>>;
  awakes: Array<Pick<AwakeRow, 'started_at' | 'ended_at'>>;
};

export function getMultiTrendRecords(roomId: string, startIso: string): MultiTrendRecordSets {
  const db = getDatabase();
  return {
    feeds: db.prepare(`SELECT started_at, amount_ml FROM feed_records WHERE room_id = ? AND started_at >= ? ORDER BY started_at ASC`).all(roomId, startIso) as Array<Pick<FeedRow, 'started_at' | 'amount_ml'>>,
    poops: db.prepare(`SELECT started_at FROM poop_records WHERE room_id = ? AND started_at >= ? ORDER BY started_at ASC`).all(roomId, startIso) as Array<Pick<PoopRow, 'started_at'>>,
    medications: db.prepare(`SELECT started_at FROM medication_records WHERE room_id = ? AND started_at >= ? ORDER BY started_at ASC`).all(roomId, startIso) as Array<Pick<MedicationRow, 'started_at'>>,
    solid_foods: db.prepare(`SELECT started_at FROM solid_food_records WHERE room_id = ? AND started_at >= ? ORDER BY started_at ASC`).all(roomId, startIso) as Array<Pick<SolidFoodRow, 'started_at'>>,
    awakes: db.prepare(`SELECT started_at, ended_at FROM awake_records WHERE room_id = ? AND started_at >= ? ORDER BY started_at ASC`).all(roomId, startIso) as Array<Pick<AwakeRow, 'started_at' | 'ended_at'>>,
  };
}

export function getLastFeed(roomId: string): Pick<FeedRow, 'id' | 'feed_type' | 'started_at' | 'amount_ml'> | undefined {
  return getDatabase().prepare('SELECT id, feed_type, started_at, amount_ml FROM feed_records WHERE room_id = ? ORDER BY started_at DESC LIMIT 1').get(roomId) as Pick<FeedRow, 'id' | 'feed_type' | 'started_at' | 'amount_ml'> | undefined;
}

export function insertFeed(input: Omit<FeedRow, 'id' | 'created_at'> & { id?: string }): FeedRow {
  const row: FeedRow = { ...input, id: input.id || createId(), created_at: nowIso() };
  getDatabase().prepare(`INSERT INTO feed_records
    (id, room_id, feeder_name, feed_type, duration_minutes, amount_ml, note, started_at, created_at)
    VALUES (@id, @room_id, @feeder_name, @feed_type, @duration_minutes, @amount_ml, @note, @started_at, @created_at)`).run(row);
  return row;
}

export function updateFeed(id: string, updates: Partial<Pick<FeedRow, 'amount_ml' | 'started_at' | 'feeder_name' | 'note'>>): FeedRow | undefined {
  const fields = Object.keys(updates) as Array<keyof typeof updates>;
  if (!fields.length) return undefined;
  const setClause = fields.map((field) => `${field} = @${field}`).join(', ');
  getDatabase().prepare(`UPDATE feed_records SET ${setClause} WHERE id = @id`).run({ ...updates, id });
  return getDatabase().prepare('SELECT * FROM feed_records WHERE id = ?').get(id) as FeedRow | undefined;
}

export function deleteById(table: 'feed_records' | TimedRecordTable, id: string): void {
  getDatabase().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

function getTimedRows<T>(table: TimedRecordTable, roomId: string, startIso?: string): T[] {
  const db = getDatabase();
  const query = startIso
    ? `SELECT * FROM ${table} WHERE room_id = ? AND started_at >= ? ORDER BY started_at DESC`
    : `SELECT * FROM ${table} WHERE room_id = ? ORDER BY started_at DESC`;
  return (startIso ? db.prepare(query).all(roomId, startIso) : db.prepare(query).all(roomId)) as T[];
}

export function getPoops(roomId: string, startIso?: string): PoopRow[] { return getTimedRows<PoopRow>('poop_records', roomId, startIso); }
export function getMedications(roomId: string, startIso?: string): MedicationRow[] { return getTimedRows<MedicationRow>('medication_records', roomId, startIso); }
export function getAwakes(roomId: string, startIso?: string): AwakeRow[] { return getTimedRows<AwakeRow>('awake_records', roomId, startIso); }
export function getSolidFoods(roomId: string, startIso?: string): SolidFoodRow[] { return getTimedRows<SolidFoodRow>('solid_food_records', roomId, startIso); }

export function insertPoop(input: Omit<PoopRow, 'id' | 'created_at'>): PoopRow {
  const row: PoopRow = { ...input, id: createId(), created_at: nowIso() };
  getDatabase().prepare(`INSERT INTO poop_records
    (id, room_id, recorder_name, color, consistency, note, started_at, created_at)
    VALUES (@id, @room_id, @recorder_name, @color, @consistency, @note, @started_at, @created_at)`).run(row);
  return row;
}

export function insertMedication(input: Omit<MedicationRow, 'id' | 'created_at'>): MedicationRow {
  const row: MedicationRow = { ...input, id: createId(), created_at: nowIso() };
  getDatabase().prepare(`INSERT INTO medication_records
    (id, room_id, recorder_name, medicine_name, dosage, note, started_at, created_at)
    VALUES (@id, @room_id, @recorder_name, @medicine_name, @dosage, @note, @started_at, @created_at)`).run(row);
  return row;
}

export function insertAwake(input: Omit<AwakeRow, 'id' | 'created_at' | 'ended_at'> & { ended_at?: string | null }): AwakeRow {
  const row: AwakeRow = { ...input, id: createId(), ended_at: input.ended_at ?? null, created_at: nowIso() };
  getDatabase().prepare(`INSERT INTO awake_records
    (id, room_id, recorder_name, note, started_at, ended_at, created_at)
    VALUES (@id, @room_id, @recorder_name, @note, @started_at, @ended_at, @created_at)`).run(row);
  return row;
}

export function insertSolidFood(input: Omit<SolidFoodRow, 'id' | 'created_at'>): SolidFoodRow {
  const row: SolidFoodRow = { ...input, id: createId(), created_at: nowIso() };
  getDatabase().prepare(`INSERT INTO solid_food_records
    (id, room_id, recorder_name, food_name, amount_value, amount_unit, note, started_at, created_at)
    VALUES (@id, @room_id, @recorder_name, @food_name, @amount_value, @amount_unit, @note, @started_at, @created_at)`).run(row);
  return row;
}

export function updateRow<T extends PoopRow | MedicationRow | AwakeRow>(
  table: 'poop_records' | 'medication_records' | 'awake_records',
  id: string,
  updates: Record<string, unknown>,
): T | undefined {
  const fields = Object.keys(updates);
  if (!fields.length) return undefined;
  const setClause = fields.map((field) => `${field} = @${field}`).join(', ');
  getDatabase().prepare(`UPDATE ${table} SET ${setClause} WHERE id = @id`).run({ ...updates, id });
  return getDatabase().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as T | undefined;
}

export function getActiveAwake(roomId: string): AwakeRow | undefined {
  return getDatabase().prepare(`SELECT * FROM awake_records
    WHERE room_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(roomId) as AwakeRow | undefined;
}
