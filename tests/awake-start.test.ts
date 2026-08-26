import assert from 'node:assert/strict';
import test from 'node:test';

import { coordinateAwakeStart, getPendingAwakeRecord } from '../src/lib/awake-start';

test('creates and refreshes a new awake record', async () => {
  let createCalls = 0;
  let refreshCalls = 0;
  const record = { id: 'awake-1' };

  const result = await coordinateAwakeStart({
    pendingRecord: null,
    createRecord: async () => {
      createCalls += 1;
      return record;
    },
    refreshRoom: async () => {
      refreshCalls += 1;
      return true;
    },
  });

  assert.deepEqual(result, { status: 'synced', record, created: true });
  assert.equal(createCalls, 1);
  assert.equal(refreshCalls, 1);
});

test('reports a create failure without refreshing', async () => {
  let refreshCalls = 0;

  const result = await coordinateAwakeStart({
    pendingRecord: null as { id: string } | null,
    createRecord: async () => {
      throw new Error('create failed');
    },
    refreshRoom: async () => {
      refreshCalls += 1;
      return true;
    },
  });

  assert.deepEqual(result, { status: 'create-failed' });
  assert.equal(refreshCalls, 0);
});

test('returns sync-failed when refresh returns false or rejects', async () => {
  const record = { id: 'awake-1' };

  const falseResult = await coordinateAwakeStart({
    pendingRecord: null,
    createRecord: async () => record,
    refreshRoom: async () => false,
  });
  const rejectedResult = await coordinateAwakeStart({
    pendingRecord: record,
    createRecord: async () => {
      throw new Error('should not create');
    },
    refreshRoom: async () => {
      throw new Error('refresh failed');
    },
  });

  assert.deepEqual(falseResult, { status: 'sync-failed', record, created: true });
  assert.deepEqual(rejectedResult, { status: 'sync-failed', record, created: false });
});

test('retries a pending record by refreshing without creating it again', async () => {
  let createCalls = 0;
  let refreshCalls = 0;
  const record = { id: 'awake-1' };

  const first = await coordinateAwakeStart({
    pendingRecord: null,
    createRecord: async () => {
      createCalls += 1;
      return record;
    },
    refreshRoom: async () => {
      refreshCalls += 1;
      return false;
    },
  });
  assert.deepEqual(first, { status: 'sync-failed', record, created: true });

  const second = await coordinateAwakeStart({
    pendingRecord: first.record,
    createRecord: async () => {
      createCalls += 1;
      return record;
    },
    refreshRoom: async () => {
      refreshCalls += 1;
      return true;
    },
  });

  assert.deepEqual(second, { status: 'synced', record, created: false });
  assert.equal(createCalls, 1);
  assert.equal(refreshCalls, 2);
});

test('ignores a pending record from another room and creates for the current room', async () => {
  const pending = { roomId: 'room-a', record: { id: 'awake-a' } };
  let createCalls = 0;

  const result = await coordinateAwakeStart({
    pendingRecord: getPendingAwakeRecord(pending, 'room-b'),
    createRecord: async () => {
      createCalls += 1;
      return { id: 'awake-b' };
    },
    refreshRoom: async () => true,
  });

  assert.deepEqual(result, { status: 'synced', record: { id: 'awake-b' }, created: true });
  assert.equal(createCalls, 1);
});
