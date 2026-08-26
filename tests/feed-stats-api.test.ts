import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { NextRequest } from 'next/server';
import { GET as getFeedStats } from '../src/app/api/rooms/[id]/feed-stats/route';
import {
  insertAwake,
  insertFeed,
  insertMedication,
  insertPoop,
  insertRoom,
  insertSolidFood,
} from '../src/storage/database/sqlite';

const previousSqlitePath = process.env.SQLITE_PATH;
let temporaryDirectory: string | undefined;
let roomId: string;

before(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'baby-feed-stats-api-'));
  process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');
  roomId = insertRoom({ code: 'STAT01', name: '统计宝宝' }).id;
});

after(() => {
  try { globalThis.__babyFeedSqlite?.close(); } finally {
    globalThis.__babyFeedSqlite = undefined;
    if (previousSqlitePath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = previousSqlitePath;
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function request(query = '', id = roomId): NextRequest {
  return new NextRequest(`http://localhost/api/rooms/${id}/feed-stats${query}`);
}

test('returns continuous daily trend with stable fields and room isolation', async () => {
  const nowIso = new Date().toISOString();
  const awakeStartedAt = new Date(Date.parse(nowIso) - 30 * 60 * 1000).toISOString();
  insertFeed({ room_id: roomId, feeder_name: '妈妈', feed_type: 'bottle', duration_minutes: null, amount_ml: 120, note: null, started_at: nowIso });
  insertFeed({ room_id: roomId, feeder_name: '爸爸', feed_type: 'left', duration_minutes: 10, amount_ml: null, note: null, started_at: nowIso });
  insertPoop({ room_id: roomId, recorder_name: '妈妈', color: null, consistency: null, note: null, started_at: nowIso });
  insertMedication({ room_id: roomId, recorder_name: '爸爸', medicine_name: '维生素D', dosage: null, note: null, started_at: nowIso });
  insertSolidFood({ room_id: roomId, recorder_name: '妈妈', food_name: '米糊', amount_value: null, amount_unit: null, note: null, started_at: nowIso });
  insertAwake({ room_id: roomId, recorder_name: '爸爸', note: null, started_at: awakeStartedAt, ended_at: nowIso });
  const otherRoom = insertRoom({ code: 'STAT02', name: '另一个宝宝' });
  insertFeed({ room_id: otherRoom.id, feeder_name: '奶奶', feed_type: 'bottle', duration_minutes: null, amount_ml: 999, note: null, started_at: new Date().toISOString() });
  const response = await getFeedStats(request('?granularity=day&range=3'), { params: Promise.resolve({ id: roomId }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.data.granularity, 'day');
  assert.equal(payload.data.bucket_count, 3);
  assert.equal(payload.data.points.length, 3);
  assert.deepEqual(Object.keys(payload.data.points[0]).sort(), ['events', 'feed_count', 'label', 'measured_count', 'period_start', 'total_ml']);
  assert.equal(payload.data.points.at(-1).total_ml, 120);
  assert.equal(payload.data.points.at(-1).feed_count, 2);
  assert.equal(payload.data.points.at(-1).measured_count, 1);
  assert.deepEqual(payload.data.points.at(-1).events, {
    poop_count: 1,
    medication_count: 1,
    solid_food_count: 1,
    awake_count: 1,
    awake_minutes: 30,
  });
});

test('omits active awake and aggregates previous-business-day events', async () => {
  const trendRoom = insertRoom({ code: 'STAT03', name: '连续统计宝宝' });
  const now = new Date();
  const previousBusinessDayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  insertAwake({
    room_id: trendRoom.id,
    recorder_name: '妈妈',
    note: null,
    started_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
    ended_at: null,
  });
  insertPoop({ room_id: trendRoom.id, recorder_name: '爸爸', color: null, consistency: null, note: null, started_at: previousBusinessDayIso });
  const response = await getFeedStats(request('?granularity=day&range=2', trendRoom.id), { params: Promise.resolve({ id: trendRoom.id }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.points.length, 2);
  assert.deepEqual(payload.data.points.at(-1).events, {
    poop_count: 0,
    medication_count: 0,
    solid_food_count: 0,
    awake_count: 0,
    awake_minutes: 0,
  });
  assert.deepEqual(payload.data.points.at(-2).events, {
    poop_count: 1,
    medication_count: 0,
    solid_food_count: 0,
    awake_count: 0,
    awake_minutes: 0,
  });
});

test('supports weekly and monthly trends', async () => {
  for (const granularity of ['week', 'month'] as const) {
    const response = await getFeedStats(request(`?granularity=${granularity}`), { params: Promise.resolve({ id: roomId }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.granularity, granularity);
    assert.equal(payload.data.bucket_count, 12);
    assert.equal(payload.data.points.length, 12);
  }
});

test('rejects invalid granularity and range', async () => {
  for (const query of ['?granularity=', '?granularity=year', '?granularity=day&range=0', '?granularity=day&range=91', '?granularity=week&range=13', '?granularity=month&range=-1', '?granularity=day&range=nope']) {
    const response = await getFeedStats(request(query), { params: Promise.resolve({ id: roomId }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, error: '无效的统计粒度或范围' });
  }
});

test('returns 404 for unknown room', async () => {
  const response = await getFeedStats(new NextRequest('http://localhost/api/rooms/missing/feed-stats'), { params: Promise.resolve({ id: 'missing' }) });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: '房间不存在' });
});
