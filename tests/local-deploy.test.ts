import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';

type RunOverrides = Record<string, string | undefined>;

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const fakeCommand = `#!/bin/bash
set -Eeuo pipefail
name="$(basename "$0")"
printf '%s|%s\\n' "$name" "$*" >> "$DEPLOY_TEST_LOG"

case "$name" in
  git)
    if [[ " $* " == *" diff --quiet "* || " $* " == *" diff --cached --quiet "* ]]; then
      [[ "\${FAKE_GIT_DIRTY:-0}" != 1 ]]
    elif [[ " $* " == *" rev-parse HEAD "* ]]; then
      printf '%s\\n' "\${FAKE_GIT_SHA:-0123456789abcdef0123456789abcdef01234567}"
    fi
    ;;
  docker)
    case "\${1:-}" in
      info) ;;
      buildx)
        [[ "\${2:-}" == version ]] && exit 0
        [[ "\${2:-}" == build ]] && exit 0
        ;;
      save) printf 'fake-image-bytes' ;;
      *) ;;
    esac
    ;;
  ssh|scp)
    # Consume streamed release scripts so the caller cannot block in tests.
    if [[ "$name" == ssh ]]; then cat >/dev/null; fi
    ;;
  pnpm) ;;
  *) ;;
esac
`;

function createFixture(overrides: RunOverrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'baby-feed-local-deploy-'));
  temporaryRoots.push(root);
  const fakeBin = path.join(root, 'bin');
  mkdirSync(fakeBin, { recursive: true });
  const commandLog = path.join(root, 'commands.log');
  const configFile = path.join(root, 'deploy.env');
  writeFileSync(commandLog, '');
  for (const name of ['git', 'docker', 'ssh', 'scp', 'pnpm']) {
    const filename = path.join(fakeBin, name);
    writeFileSync(filename, fakeCommand);
    chmodSync(filename, 0o755);
  }

  const config = {
    DEPLOY_TARGET: 'baby-feed-server',
    DEPLOY_DIR: '/opt/baby-feed',
    APP_PORT: '9001',
    BACKUP_KEEP: '10',
    IMAGE_KEEP: '3',
    HEALTH_TIMEOUT: '60',
    ...overrides,
  };
  writeFileSync(
    configFile,
    Object.entries(config)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value ?? ''}`)
      .join('\n') + '\n',
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEPLOY_CONFIG_FILE: configFile,
    DEPLOY_TEST_LOG: commandLog,
    FAKE_GIT_SHA: '0123456789abcdef0123456789abcdef01234567',
    FAKE_GIT_DIRTY: '0',
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (key.startsWith('FAKE_')) env[key] = value;
  }

  return {
    run(action: string) {
      return spawnSync('bash', ['scripts/deploy.sh', action], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env,
      });
    },
    commandLog() {
      return readFileSync(commandLog, 'utf8');
    },
  };
}

function runLocalDeploy(action: string, overrides: RunOverrides = {}) {
  const fixture = createFixture(overrides);
  const result = fixture.run(action);
  return {
    ...result,
    commandLog: fixture.commandLog(),
  };
}

test('rejects missing target and invalid numeric configuration before SSH', () => {
  const missing = runLocalDeploy('check', { DEPLOY_TARGET: '' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /DEPLOY_TARGET/);
  assert.equal(missing.commandLog.includes('ssh|'), false);

  const invalid = runLocalDeploy('check', { DEPLOY_TARGET: 'server', APP_PORT: 'zero' });
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.commandLog.includes('ssh|'), false);
});

test('builds amd64 by Git SHA, uploads artifacts, and invokes remote deploy', () => {
  const result = runLocalDeploy('deploy', {
    DEPLOY_TARGET: 'baby-feed-server',
    FAKE_GIT_SHA: 'abcdef1234567890',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commandLog, /pnpm\|.* test/);
  assert.match(result.commandLog, /pnpm\|.* run validate/);
  assert.match(result.commandLog, /docker\|buildx build --platform linux\/amd64/);
  assert.match(result.commandLog, /-t baby-feed:abcdef123456/);
  assert.match(result.commandLog, /scp\|.*image-abcdef123456\.tar\.gz/);
  assert.match(result.commandLog, /ssh\|.* deploy baby-feed:abcdef123456/);
});

test('does not build or upload when tracked files are dirty', () => {
  const result = runLocalDeploy('deploy', {
    DEPLOY_TARGET: 'baby-feed-server',
    FAKE_GIT_DIRTY: '1',
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.commandLog.includes('docker|buildx build'), false);
  assert.equal(result.commandLog.includes('scp|'), false);
});
