import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('builds dependencies inside Linux and runs as the fixed non-root user', () => {
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  assert.match(dockerfile, /FROM node:20-bookworm-slim AS deps/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /USER 10001:10001/);
  assert.match(dockerfile, /CMD \["node", "dist\/server\.js"\]/);
  assert.doesNotMatch(dockerfile, /COPY .*node_modules/);
});

test('bind mounts the existing SQLite directory and checks the health endpoint', () => {
  const compose = readFileSync('deploy/compose.yaml', 'utf8');
  assert.match(compose, /image: "\$\{BABY_FEED_IMAGE:\?/);
  assert.match(compose, /source: \$\{DATA_DIR:-\/opt\/baby-feed\/data\}/);
  assert.match(compose, /target: \/app\/data/);
  assert.match(compose, /SQLITE_PATH: \/app\/data\/baby-feed\.sqlite/);
  assert.match(compose, /HOSTNAME: 0\.0\.0\.0/);
  assert.match(compose, /\/api\/health/);
  assert.doesNotMatch(compose, /^volumes:/m);
});

test('keeps local data and deployment credentials out of the image context', () => {
  const ignored = readFileSync('.dockerignore', 'utf8');
  assert.match(ignored, /^node_modules$/m);
  assert.match(ignored, /^data$/m);
  assert.match(ignored, /^\.env\.deploy$/m);
  assert.match(ignored, /^\*\.sqlite\*$/m);
});
