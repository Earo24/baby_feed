import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { GET } from '../src/app/api/health/route';

const previousSqlitePath = process.env.SQLITE_PATH;
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'baby-feed-health-'));

function resetDatabase(): void {
  globalThis.__babyFeedSqlite?.close();
  globalThis.__babyFeedSqlite = undefined;
}

after(() => {
  resetDatabase();
  if (previousSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = previousSqlitePath;
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('reports a healthy SQLite connection without exposing internal paths', async () => {
  process.env.SQLITE_PATH = path.join(temporaryDirectory, 'health.sqlite');
  resetDatabase();
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('reports an unavailable SQLite connection without exposing the error', async () => {
  process.env.SQLITE_PATH = temporaryDirectory;
  resetDatabase();
  const response = await GET();
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.deepEqual(body, { status: 'unhealthy' });
  assert.equal(JSON.stringify(body).includes(temporaryDirectory), false);
});
