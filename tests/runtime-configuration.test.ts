import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const projectRoot = process.cwd();

test('does not require the legacy project metadata or runtime environment', () => {
  assert.equal(existsSync(path.join(projectRoot, '.coze')), false);

  const runtimeFiles = [
    'src/server.ts',
    'src/app/layout.tsx',
    'next.config.ts',
    'scripts/prepare.sh',
    'scripts/build.sh',
    'scripts/dev.sh',
    'scripts/start.sh',
    'scripts/validate.sh',
    'Dockerfile',
    'deploy/compose.yaml',
    'deploy/baby-feed.service',
  ];

  for (const relativePath of runtimeFiles) {
    const source = readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /COZE_|coze\.site|command -v coze|\.coze/);
  }

  assert.match(readFileSync(path.join(projectRoot, '.gitignore'), 'utf8'), /^\.coze$/m);
  assert.match(readFileSync(path.join(projectRoot, '.dockerignore'), 'utf8'), /^\.coze$/m);
});
