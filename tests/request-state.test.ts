import assert from 'node:assert/strict';
import test from 'node:test';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function importRequestState() {
  const modulePath = '../src/lib/request-state';
  try {
    return await import(modulePath);
  } catch (error) {
    assert.fail(`request-state module should exist: ${String(error)}`);
  }
}

test('rejects an older room response and commits the latest room response', async () => {
  const { createLatestRequestGate } = await importRequestState();
  const gate = createLatestRequestGate();
  const oldRoom = gate.begin('room-a');
  const latestRoom = gate.begin('room-b');

  assert.equal(gate.isLatest(oldRoom), false);
  assert.equal(gate.isLatest(latestRoom), true);

  gate.invalidate();
  assert.equal(gate.isLatest(latestRoom), false);
});

test('keeps a late 7-day response from replacing the latest 30-day response', async () => {
  const { createLatestRequestGate } = await importRequestState();
  const gate = createLatestRequestGate();
  const sevenDayResponse = deferred<string>();
  const thirtyDayResponse = deferred<string>();
  const commits: string[] = [];

  const run = async (key: string, response: Deferred<string>) => {
    const token = gate.begin(key);
    const value = await response.promise;
    if (gate.isLatest(token)) commits.push(value);
  };

  const oldRequest = run('room-a:7', sevenDayResponse);
  const latestRequest = run('room-a:30', thirtyDayResponse);
  thirtyDayResponse.resolve('30 days');
  await latestRequest;
  sevenDayResponse.resolve('7 days');
  await oldRequest;

  assert.deepEqual(commits, ['30 days']);
});

test('matches history commits against the active room and requested day range', async () => {
  const { createRequestState } = await importRequestState();
  const state = createRequestState(7);

  state.setActiveRoomId('room-a');
  assert.equal(state.matchesHistory('room-a', 7), true);
  assert.equal(state.matchesHistory('room-b', 7), false);

  state.setHistoryDays(30);
  assert.equal(state.matchesHistory('room-a', 7), false);
  assert.equal(state.matchesHistory('room-a', 30), true);

  state.setActiveRoomId(null);
  assert.equal(state.matchesHistory('room-a', 30), false);
});

test('resolves deletion refresh context when the deletion finishes', async () => {
  const { createRequestState } = await importRequestState();
  const state = createRequestState(7);
  const deletion = deferred<void>();
  state.setActiveRoomId('room-a');
  state.setHistoryOpen(true);

  const contextAfterDeletion = (async () => {
    await deletion.promise;
    return state.getRefreshContext();
  })();

  state.setHistoryDays(30);
  deletion.resolve();
  assert.deepEqual(await contextAfterDeletion, {
    roomId: 'room-a',
    days: 30,
    showHistory: true,
  });

  state.setHistoryOpen(false);
  assert.deepEqual(state.getRefreshContext(), {
    roomId: 'room-a',
    days: 30,
    showHistory: false,
  });

  state.setActiveRoomId(null);
  assert.deepEqual(state.getRefreshContext(), {
    roomId: null,
    days: 30,
    showHistory: false,
  });
});

test('loads history as one complete five-type snapshot and rejects partial failures', async () => {
  const { fetchHistorySnapshot } = await importRequestState();
  const requestedUrls: string[] = [];
  const records = {
    feeds: [{ id: 'feed-1' }],
    poops: [{ id: 'poop-1' }],
    medications: [{ id: 'med-1' }],
    awakes: [{ id: 'awake-1' }],
    'solid-foods': [{ id: 'solid-1' }],
  };
  const fetcher = async (url: string) => {
    requestedUrls.push(url);
    const type = url.match(/\/(feeds|poops|medications|awakes|solid-foods)\?/)?.[1] as keyof typeof records;
    return { ok: true, json: async () => ({ success: true, data: records[type] }) };
  };

  const snapshot = await fetchHistorySnapshot('room-a', 14, fetcher);

  assert.deepEqual(snapshot, {
    feeds: records.feeds,
    poops: records.poops,
    medications: records.medications,
    awakes: records.awakes,
    solidFoods: records['solid-foods'],
  });
  assert.equal(requestedUrls.length, 5);
  assert.ok(requestedUrls.every((url) => url.includes('/room-a/') && url.endsWith('?days=14')));

  const failingFetcher = async (url: string) => ({
    ok: true,
    json: async () => url.includes('/poops?')
      ? { success: false, error: 'failed' }
      : { success: true, data: [] },
  });
  await assert.rejects(fetchHistorySnapshot('room-a', 7, failingFetcher), /history request failed/);
});
