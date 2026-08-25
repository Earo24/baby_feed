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
  insertSolidFood,
} from '../src/storage/database/sqlite';
import { getChinaCycleStart } from '../src/storage/database/time';

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

  const malformedJsonResponse = await createSolidFood(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods`, {
      method: 'POST',
      body: '{"food_name":',
      headers: { 'content-type': 'application/json' },
    }),
    roomContext,
  );

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

  const missingRoomListResponse = await getSolidFoods(
    new NextRequest('http://localhost/api/rooms/missing-room/solid-foods'),
    { params: Promise.resolve({ id: 'missing-room' }) },
  );
  assert.deepEqual(
    [
      { status: malformedJsonResponse.status, body: await malformedJsonResponse.json() },
      { status: missingRoomListResponse.status, body: await missingRoomListResponse.json() },
    ],
    [
      { status: 400, body: { success: false, error: '请求数据格式错误' } },
      { status: 404, body: { success: false, error: '房间不存在' } },
    ],
  );

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

  const cycleStart = Date.parse(getChinaCycleStart());
  const currentCycleRecord = insertSolidFood({
    room_id: roomId,
    recorder_name: '妈妈',
    food_name: '南瓜泥',
    amount_value: 2,
    amount_unit: 'spoon',
    note: null,
    started_at: new Date(cycleStart + 60_000).toISOString(),
  });
  const beforeCycleRecord = insertSolidFood({
    room_id: roomId,
    recorder_name: '爸爸',
    food_name: '香蕉泥',
    amount_value: null,
    amount_unit: null,
    note: null,
    started_at: new Date(cycleStart - 1).toISOString(),
  });
  const twentyDayOldRecord = insertSolidFood({
    room_id: roomId,
    recorder_name: '妈妈',
    food_name: '苹果泥',
    amount_value: 30,
    amount_unit: 'g',
    note: null,
    started_at: new Date(Date.parse(getChinaCycleStart(21)) + 60_000).toISOString(),
  });
  const beyondThirtyDayRecord = insertSolidFood({
    room_id: roomId,
    recorder_name: null,
    food_name: '过期记录',
    amount_value: null,
    amount_unit: null,
    note: null,
    started_at: new Date(Date.parse(getChinaCycleStart(30)) - 1).toISOString(),
  });

  const otherRoom = insertRoom({ code: 'SOLID3', name: '另一个宝宝' });
  const otherRoomRecord = insertSolidFood({
    room_id: otherRoom.id,
    recorder_name: '奶奶',
    food_name: '土豆泥',
    amount_value: 20,
    amount_unit: 'g',
    note: null,
    started_at: new Date().toISOString(),
  });

  for (const daysQuery of ['', '?days=invalid', '?days=0']) {
    const boundedResponse = await getSolidFoods(
      new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods${daysQuery}`),
      roomContext,
    );
    assert.equal(boundedResponse.status, 200);
    assert.deepEqual(await boundedResponse.json(), { success: true, data: [currentCycleRecord] });
  }

  const clampedResponse = await getSolidFoods(
    new NextRequest(`http://localhost/api/rooms/${roomId}/solid-foods?days=999`),
    roomContext,
  );
  assert.equal(clampedResponse.status, 200);
  const clampedPayload = await clampedResponse.json();
  const clampedIds = clampedPayload.data.map(({ id }: { id: string }) => id);
  assert.equal(clampedPayload.success, true);
  assert.ok(clampedIds.includes(twentyDayOldRecord.id));
  assert.ok(clampedIds.includes(beforeCycleRecord.id));
  assert.ok(!clampedIds.includes(beyondThirtyDayRecord.id));
  assert.ok(!clampedIds.includes(otherRoomRecord.id));

  for (let index = 0; index < 51; index += 1) {
    insertSolidFood({
      room_id: roomId,
      recorder_name: '妈妈',
      food_name: `辅食 ${index + 1}`,
      amount_value: null,
      amount_unit: null,
      note: null,
      started_at: new Date().toISOString(),
    });
  }

  const cappedRoomResponse = await getRoom(
    new NextRequest(`http://localhost/api/rooms/${roomId}`),
    roomContext,
  );
  assert.equal(cappedRoomResponse.status, 200);
  const cappedRoomPayload = await cappedRoomResponse.json();
  assert.equal(cappedRoomPayload.success, true);
  assert.equal(cappedRoomPayload.data.solid_foods.length, 50);
  assert.ok(cappedRoomPayload.data.solid_foods.every(
    ({ room_id }: { room_id: string }) => room_id === roomId,
  ));
  assert.equal(cappedRoomPayload.data.lastFeed.id, feedId);
  assert.equal(cappedRoomPayload.data.feeds.length, 1);
});
