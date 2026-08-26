import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { afterEach, test } from 'node:test';

import { createFakeCommands } from './deploy-test-helpers';

type FixtureOptions = {
  httpHealthy?: boolean;
  systemdActive?: boolean;
  tarFails?: boolean;
};

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'baby-feed-release-'));
  temporaryRoots.push(root);

  const dataDirectory = path.join(root, 'data');
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(path.join(root, 'deploy'), { recursive: true });
  mkdirSync(path.join(root, 'backups'), { recursive: true });
  mkdirSync(path.join(root, 'incoming'), { recursive: true });
  writeFileSync(path.join(dataDirectory, 'baby-feed.sqlite'), 'sqlite-main');
  writeFileSync(path.join(dataDirectory, 'baby-feed.sqlite-wal'), 'sqlite-wal');

  const archive = path.join(root, 'baby-feed-image.tar.gz');
  const compose = path.join(root, 'compose-source.yaml');
  const logFile = path.join(root, 'commands.log');
  writeFileSync(archive, gzipSync('fake docker image archive'));
  writeFileSync(compose, 'services:\n  app:\n    image: ${BABY_FEED_IMAGE}\n');
  writeFileSync(logFile, '');

  const fakeBin = createFakeCommands(root);
  const env = {
    ...process.env,
    APP_PORT: '19001',
    DEPLOY_DIR: root,
    DEPLOY_TEST_LOG: logFile,
    FAKE_HTTP_HEALTH: options.httpHealthy === false ? '0' : '1',
    FAKE_SYSTEMD_ACTIVE: options.systemdActive === false ? '0' : '1',
    FAKE_TAR_FAIL: options.tarFails ? '1' : '0',
    HEALTH_TIMEOUT: '1',
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
  };

  return {
    archive,
    compose,
    run(...args: string[]) {
      return spawnSync('bash', ['deploy/remote-release.sh', ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env,
      });
    },
    commandLog() {
      return readFileSync(logFile, 'utf8');
    },
    backedUpDataNames() {
      const backupDirectory = path.join(root, 'backups');
      const releaseBackup = readdirSync(backupDirectory)
        .map((name) => path.join(backupDirectory, name))
        .find((filename) => !filename.includes('.partial.'));
      assert.ok(releaseBackup, 'expected a completed release backup');
      return execFileSync('tar', ['-tzf', path.join(releaseBackup, 'data.tar.gz')], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter((name) => name !== './')
        .sort();
    },
    dataDigest() {
      const hash = createHash('sha256');
      for (const name of readdirSync(dataDirectory).sort()) {
        hash.update(name);
        hash.update(readFileSync(path.join(dataDirectory, name)));
      }
      return hash.digest('hex');
    },
    releaseValue(key: string) {
      const release = readFileSync(path.join(root, 'deploy', 'release.env'), 'utf8');
      return release
        .split('\n')
        .find((line) => line.startsWith(`${key}=`))
        ?.slice(key.length + 1);
    },
  };
}

test('loads before downtime, backs up all SQLite files, then disables systemd', () => {
  const fixture = createFixture({ systemdActive: true, httpHealthy: true });
  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);
  assert.equal(result.status, 0, result.stderr);
  const log = fixture.commandLog();
  assert.ok(log.indexOf('docker|load') < log.indexOf('systemctl|stop baby-feed'));
  assert.ok(log.indexOf('systemctl|stop baby-feed') < log.indexOf('tar|-'));
  assert.ok(log.indexOf('tar|-') < log.indexOf('docker|compose'));
  assert.match(log, /systemctl\|disable baby-feed/);
  assert.deepEqual(fixture.backedUpDataNames(), [
    './baby-feed.sqlite',
    './baby-feed.sqlite-wal',
  ]);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:abcdef123456');
});

test('restarts systemd and leaves data untouched when backup fails', () => {
  const fixture = createFixture({ systemdActive: true, tarFails: true });
  const before = fixture.dataDigest();
  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);
  assert.notEqual(result.status, 0);
  assert.match(fixture.commandLog(), /systemctl\|start baby-feed/);
  assert.equal(fixture.commandLog().includes('docker|compose'), false);
  assert.equal(fixture.dataDigest(), before);
});
