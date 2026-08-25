import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { NextRequest } from 'next/server';
import { DELETE as deleteSolidFood } from '../src/app/api/solid-foods/[solidFoodId]/route';
import { GET as getRoom } from '../src/app/api/rooms/[id]/route';
import {
  GET as getSolidFoods,
  POST as createSolidFood,
} from '../src/app/api/rooms/[id]/solid-foods/route';
import {
  insertFeed,
  insertRoom,
} from '../src/storage/database/sqlite';

const previousSqlitePath = process.env.SQLITE_PATH;

let temporaryDirectory: string | undefined;
let roomId: string;
let feedId: string;

before(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'baby-feed-solid-food-api-'));
  process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

  const room = insertRoom({ code: 'SOLID2', name: '接口宝宝' });
  roomId = room.id;
  feedId = insertFeed({
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
        if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }
});

test('creates, lists, exposes, and deletes solid-food records through HTTP routes', async () => {
  const roomContext = { params: Promise.resolve({ id: roomId }) };

  const blankResponse = await createSolidFood(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods`, {
      method: 'POST',
      body: JSON.stringify({ food_name: '   ' }),
      headers: { 'content-type': 'application/json' },
    }),
    roomContext,
  );
  assert.equal(blankResponse.status, 400);
  assert.deepEqual(await blankResponse.json(), { success: false, error: '请输入食物名称' });

  const missingRoomResponse = await createSolidFood(
    new NextRequest('http://localhost/api/rooms/missing-room/solid-foods', {
      method: 'POST',
      body: JSON.stringify({ food_name: '米糊' }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'missing-room' }) },
  );
  assert.equal(missingRoomResponse.status, 404);
  assert.deepEqual(await missingRoomResponse.json(), { success: false, error: '房间不存在' });

  const startedAt = new Date().toISOString();
  const createResponse = await createSolidFood(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods`, {
      method: 'POST',
      body: JSON.stringify({
        food_name: '米糊',
        amount_value: 0.5,
        amount_unit: 'bowl',
        recorder_name: '妈妈',
        started_at: startedAt,
      }),
      headers: { 'content-type': 'application/json' },
    }),
    roomContext,
  );
  assert.equal(createResponse.status, 200);
  const createPayload = await createResponse.json();
  assert.equal(createPayload.success, true);
  assert.deepEqual(createPayload.data, {
    id: createPayload.data.id,
    room_id: roomId,
    recorder_name: '妈妈',
    food_name: '米糊',
    amount_value: 0.5,
    amount_unit: 'bowl',
    note: null,
    started_at: startedAt,
    created_at: createPayload.data.created_at,
  });

  const listResponse = await getSolidFoods(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods?days=7`),
    roomContext,
  );
  assert.equal(listResponse.status, 200);
  assert.deepEqual(await listResponse.json(), { success: true, data: [createPayload.data] });

  const roomResponse = await getRoom(
    new NextRequest(`http://localhost/api/rooms/${roomId}`),
    roomContext,
  );
  assert.equal(roomResponse.status, 200);
  const roomPayload = await roomResponse.json();
  assert.equal(roomPayload.success, true);
  assert.equal(roomPayload.data.solid_foods.length, 1);
  assert.equal(roomPayload.data.solid_foods[0].id, createPayload.data.id);
  assert.equal(roomPayload.data.lastFeed.id, feedId);
  assert.equal(roomPayload.data.feeds.length, 1);

  const deleteResponse = await deleteSolidFood(
    new NextRequest(`http://localhost/api/solid-foods/${createPayload.data.id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ solidFoodId: createPayload.data.id }) },
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { success: true });

  const emptyListResponse = await getSolidFoods(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods?days=7`),
    roomContext,
  );
  assert.equal(emptyListResponse.status, 200);
  assert.deepEqual(await emptyListResponse.json(), { success: true, data: [] });
});
