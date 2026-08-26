import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { afterEach, test } from 'node:test';

import { createFakeCommands } from './deploy-test-helpers';

type FixtureOptions = {
  backupFinalizeFails?: boolean;
  backupDeleteFailures?: number;
  backupKeep?: number;
  composeUpFailures?: number;
  dockerActive?: boolean;
  dockerImagesFails?: boolean;
  dockerRmiFails?: boolean;
  findFails?: boolean;
  fixedTimestamp?: string;
  healthSequence?: string[];
  httpHealthy?: boolean;
  imageKeep?: number;
  imageList?: string[];
  stopFails?: boolean;
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

  const incomingDirectory = path.join(root, 'incoming');
  const archive = path.join(incomingDirectory, 'baby-feed-image.tar.gz');
  const compose = path.join(incomingDirectory, 'compose-source.yaml');
  const logFile = path.join(root, 'commands.log');
  writeFileSync(archive, gzipSync('fake docker image archive'));
  writeFileSync(compose, 'services:\n  app:\n    image: ${BABY_FEED_IMAGE}\n');
  writeFileSync(logFile, '');

  const fakeBin = createFakeCommands(root);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_PORT: '19001',
    DEPLOY_DIR: root,
    DEPLOY_TEST_LOG: logFile,
    FAKE_BACKUP_FINALIZE_FAIL: options.backupFinalizeFails ? '1' : '0',
    FAKE_BACKUP_DELETE_FAILURES: options.backupDeleteFailures ? String(options.backupDeleteFailures) : '0',
    BACKUP_KEEP: options.backupKeep ? String(options.backupKeep) : '10',
    FAKE_COMPOSE_UP_FAILURES: options.composeUpFailures ? String(options.composeUpFailures) : '0',
    FAKE_DOCKER_ACTIVE: options.dockerActive ? '1' : '0',
    FAKE_DOCKER_IMAGES_FAIL: options.dockerImagesFails ? '1' : '0',
    FAKE_DOCKER_RMI_FAIL: options.dockerRmiFails ? '1' : '0',
    FAKE_FIND_FAIL: options.findFails ? '1' : '0',
    FAKE_HEALTH_SEQUENCE: options.healthSequence?.join(',') ?? '',
    FAKE_HTTP_HEALTH: options.httpHealthy === false ? '0' : '1',
    IMAGE_KEEP: options.imageKeep ? String(options.imageKeep) : '3',
    FAKE_IMAGE_LIST: options.imageList?.join('\n') ?? '',
    FAKE_RUNNING_IMAGE: '',
    FAKE_STOP_FAIL: options.stopFails ? '1' : '0',
    FAKE_SYSTEMD_ACTIVE: options.systemdActive === false ? '0' : '1',
    FAKE_TAR_FAIL: options.tarFails ? '1' : '0',
    FAKE_TIMESTAMP: options.fixedTimestamp ?? '',
    FAKE_STATE_DIR: root,
    HEALTH_TIMEOUT: '1',
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    STABLE_COMPOSE_FILE: path.join(root, 'deploy', 'compose.yaml'),
    STABLE_RELEASE_ENV: path.join(root, 'deploy', 'release.env'),
  };

  return {
    archive,
    compose,
    root,
    run(...args: string[]) {
      return spawnSync('bash', ['deploy/remote-release.sh', ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env,
      });
    },
    runWithEnv(overrides: Partial<NodeJS.ProcessEnv>, ...args: string[]) {
      return spawnSync('bash', ['deploy/remote-release.sh', ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...env, ...overrides },
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
    backupCount() {
      return readdirSync(path.join(root, 'backups')).filter((name) => !name.includes('.partial.'))
        .length;
    },
    validBackupCount() {
      return readdirSync(path.join(root, 'backups')).filter((name) =>
        /^20\d{6}T\d{6}Z-[A-Za-z0-9._-]+$/.test(name),
      ).length;
    },
    remainingNonReleaseBackupNames() {
      return readdirSync(path.join(root, 'backups'))
        .filter((name) => !/^20\d{6}T\d{6}Z-[A-Za-z0-9._-]+$/.test(name))
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
    expectStableImageDuringHealth(image: string) {
      env.EXPECT_STABLE_IMAGE_DURING_HEALTH = image;
      env.EXPECT_STABLE_COMPOSE_MARKER = `# stable ${image}`;
    },
    setDockerActive(active: boolean) {
      env.FAKE_DOCKER_ACTIVE = active ? '1' : '0';
    },
    setRunningImage(image: string) {
      env.FAKE_RUNNING_IMAGE = image;
    },
    setImageList(images: string[]) {
      env.FAKE_IMAGE_LIST = images.join('\n');
    },
    writeReleaseState(current: string, previous: string) {
      writeFileSync(
        path.join(root, 'deploy', 'release.env'),
        [
          `BABY_FEED_IMAGE=${current}`,
          `CURRENT_IMAGE=${current}`,
          `PREVIOUS_IMAGE=${previous}`,
          'APP_PORT=19001',
          `DATA_DIR=${dataDirectory}`,
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(root, 'deploy', 'compose.yaml'),
        `${readFileSync(compose, 'utf8')}# stable ${current}\n`,
      );
      env.FAKE_DOCKER_ACTIVE = '1';
      env.FAKE_RUNNING_IMAGE = current;
      env.FAKE_AVAILABLE_IMAGES = `${current},${previous}`;
    },
    createBackupCollision(timestamp: string, label = 'systemd') {
      env.FAKE_TIMESTAMP = timestamp;
      const destination = path.join(root, 'backups', `${timestamp}-${label}`);
      mkdirSync(destination);
      writeFileSync(path.join(destination, 'existing-marker'), 'keep');
      return destination;
    },
    createBackups(names: string[]) {
      for (const name of names) {
        const destination = path.join(root, 'backups', name);
        mkdirSync(destination);
        writeFileSync(path.join(destination, 'metadata'), `created_at=${name}\n`);
      }
    },
    replaceDataWithExternalSymlink() {
      const external = mkdtempSync(path.join(os.tmpdir(), 'baby-feed-external-data-'));
      temporaryRoots.push(external);
      writeFileSync(path.join(external, 'baby-feed.sqlite'), 'external-main');
      rmSync(dataDirectory, { recursive: true });
      symlinkSync(external, dataDirectory);
      return external;
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
  const log = fixture.commandLog();
  assert.match(log, /systemctl\|start baby-feed/);
  assert.ok(log.indexOf('systemctl|is-active baby-feed', log.indexOf('systemctl|start baby-feed')) > 0);
  assert.equal(log.includes('docker|compose'), false);
  assert.equal(fixture.dataDigest(), before);
});

test('fails closed when backup finalization fails after tar succeeds', () => {
  const fixture = createFixture({ systemdActive: true, backupFinalizeFails: true });
  const before = fixture.dataDigest();

  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);

  assert.notEqual(result.status, 0);
  assert.match(fixture.commandLog(), /systemctl\|start baby-feed/);
  assert.equal(fixture.commandLog().includes(' up -d'), false);
  assert.equal(fixture.dataDigest(), before);
  assert.equal(
    readdirSync(path.join(fixture.root, 'backups')).some((name) => name.includes('.partial.')),
    false,
  );
});

test('refuses a colliding second-resolution backup destination', () => {
  const fixture = createFixture({ systemdActive: true });
  const destination = fixture.createBackupCollision('20260826T010203Z');

  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);

  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(path.join(destination, 'existing-marker'), 'utf8'), 'keep');
  assert.deepEqual(readdirSync(destination), ['existing-marker']);
  assert.equal(fixture.commandLog().includes(' up -d'), false);
});

test('keeps stable release files on the prior image until candidate health succeeds', () => {
  const fixture = createFixture({ systemdActive: false, dockerActive: true });
  fixture.writeReleaseState('baby-feed:1111111', 'baby-feed:0000000');
  fixture.expectStableImageDuringHealth('baby-feed:1111111');

  const candidateCompose = readFileSync(fixture.compose, 'utf8');
  const result = fixture.run('deploy', 'baby-feed:2222222', fixture.archive, fixture.compose);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:2222222');
  assert.equal(
    readFileSync(path.join(fixture.root, 'deploy', 'compose.yaml'), 'utf8'),
    candidateCompose,
  );
  assert.match(fixture.commandLog(), /docker\|compose .*candidate[^\n]* up -d --force-recreate app/);
});

test('refuses conflicting active systemd and Docker writers before downtime', () => {
  const fixture = createFixture({ systemdActive: true, dockerActive: true });

  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);

  assert.notEqual(result.status, 0);
  assert.equal(fixture.commandLog().includes('systemctl|stop'), false);
  assert.equal(fixture.commandLog().includes('tar|-'), false);
});

test('does not infer a running Docker app from stale release files', () => {
  const fixture = createFixture({ systemdActive: false, dockerActive: false });
  fixture.writeReleaseState('baby-feed:1111111', 'baby-feed:0000000');
  fixture.setDockerActive(false);

  const result = fixture.run('deploy', 'baby-feed:2222222', fixture.archive, fixture.compose);

  assert.notEqual(result.status, 0);
  assert.equal(fixture.commandLog().includes('docker|compose'), false);
  assert.equal(fixture.commandLog().includes('systemctl|start'), false);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:1111111');
});

test('refuses a running Docker image that conflicts with stable release state', () => {
  const fixture = createFixture({ systemdActive: false, dockerActive: true });
  fixture.writeReleaseState('baby-feed:1111111', 'baby-feed:0000000');
  fixture.setRunningImage('baby-feed:9999999');

  const result = fixture.run('deploy', 'baby-feed:2222222', fixture.archive, fixture.compose);

  assert.notEqual(result.status, 0);
  assert.equal(fixture.commandLog().includes(' stop app'), false);
  assert.equal(fixture.commandLog().includes('tar|-'), false);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:1111111');
});

test('does not start an inactive systemd service when no writer was active', () => {
  const fixture = createFixture({ systemdActive: false, dockerActive: false });

  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);

  assert.notEqual(result.status, 0);
  assert.equal(fixture.commandLog().includes('systemctl|start'), false);
  assert.equal(fixture.commandLog().includes('tar|-'), false);
});

test('preserves the active writer and does not back up when stopping it fails', () => {
  const fixture = createFixture({ systemdActive: true, stopFails: true });

  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);
  const log = fixture.commandLog();
  const activeCheck = log.indexOf('systemctl|is-active baby-feed');
  const stop = log.indexOf('systemctl|stop baby-feed');

  assert.notEqual(result.status, 0);
  assert.ok(activeCheck >= 0);
  assert.ok(activeCheck < stop);
  assert.equal(log.includes('tar|-'), false);
  assert.equal(log.includes('docker|compose'), false);
});

test('rejects a deployment path containing traversal before creating directories', () => {
  const fixture = createFixture();
  const traversal = `${fixture.root}/nested/../unsafe`;

  const result = fixture.runWithEnv({ DEPLOY_DIR: traversal }, 'prepare-upload');

  assert.notEqual(result.status, 0);
  assert.equal(existsSync(path.join(fixture.root, 'unsafe')), false);
});

test('rejects a data symlink that resolves outside the deployment root before chown', () => {
  const fixture = createFixture({ systemdActive: true });
  const external = fixture.replaceDataWithExternalSymlink();
  const before = readFileSync(path.join(external, 'baby-feed.sqlite'), 'utf8');

  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);

  assert.notEqual(result.status, 0);
  assert.equal(fixture.commandLog().includes('chown|-R'), false);
  assert.equal(readFileSync(path.join(external, 'baby-feed.sqlite'), 'utf8'), before);
});

test('rejects artifacts outside incoming without deleting them', () => {
  const fixture = createFixture({ systemdActive: true });
  const externalArchive = path.join(fixture.root, 'outside-image.tar.gz');
  writeFileSync(externalArchive, gzipSync('external fake image'));

  const result = fixture.run(
    'deploy',
    'baby-feed:abcdef123456',
    externalArchive,
    fixture.compose,
  );

  assert.notEqual(result.status, 0);
  assert.equal(existsSync(externalArchive), true);
  assert.equal(fixture.commandLog().includes('docker|load'), false);
});

test('rejects a symlinked incoming artifact without deleting the link or target', () => {
  const fixture = createFixture({ systemdActive: true });
  const target = path.join(fixture.root, 'outside-compose.yaml');
  const link = path.join(fixture.root, 'incoming', 'compose-link.yaml');
  writeFileSync(target, readFileSync(fixture.compose));
  symlinkSync(target, link);

  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, link);

  assert.notEqual(result.status, 0);
  assert.equal(existsSync(link), true);
  assert.equal(existsSync(target), true);
  assert.equal(fixture.commandLog().includes('docker|load'), false);
});

test('bounds each HTTP health request by the remaining health timeout', () => {
  const fixture = createFixture({ systemdActive: true, httpHealthy: true });

  const result = fixture.run('deploy', 'baby-feed:abcdef123456', fixture.archive, fixture.compose);

  assert.equal(result.status, 0, result.stderr);
  assert.match(fixture.commandLog(), /curl\|--connect-timeout 1 --max-time 1 --fail/);
});

test('restores the prior image state without restoring SQLite when health fails', () => {
  const fixture = createFixture({ systemdActive: false, healthSequence: ['unhealthy', 'healthy'] });
  fixture.writeReleaseState('baby-feed:1111111', 'baby-feed:0000000');
  const before = fixture.dataDigest();
  const result = fixture.run('deploy', 'baby-feed:2222222', fixture.archive, fixture.compose);
  assert.notEqual(result.status, 0);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:1111111');
  assert.equal(fixture.releaseValue('PREVIOUS_IMAGE'), 'baby-feed:0000000');
  assert.equal(fixture.dataDigest(), before);
  assert.equal(fixture.commandLog().match(/compose[^\n]*up -d/g)?.length, 2);
});

test('manual rollback backs up current data and swaps successful image tags', () => {
  const fixture = createFixture({ systemdActive: false, httpHealthy: true });
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  const result = fixture.run('rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:1111111');
  assert.equal(fixture.releaseValue('PREVIOUS_IMAGE'), 'baby-feed:2222222');
  assert.equal(fixture.backupCount(), 1);
});

test('restores the prior release state when Compose cannot start the candidate', () => {
  const fixture = createFixture({ systemdActive: false, httpHealthy: true, composeUpFailures: 1 });
  fixture.writeReleaseState('baby-feed:1111111', 'baby-feed:0000000');
  const result = fixture.run('deploy', 'baby-feed:2222222', fixture.archive, fixture.compose);
  assert.notEqual(result.status, 0);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:1111111');
  assert.equal(fixture.releaseValue('PREVIOUS_IMAGE'), 'baby-feed:0000000');
  assert.match(fixture.commandLog(), /docker\|compose.*up -d.*app/);
});

test('retention removes only excess valid backup directories', () => {
  const fixture = createFixture({ systemdActive: false, httpHealthy: true, backupKeep: 2 });
  fixture.createBackups([
    '20260820T010101Z-old',
    '20260821T010101Z-old',
    '20260822T010101Z-old',
    'keep-me',
  ]);
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  assert.equal(fixture.run('rollback').status, 0);
  assert.deepEqual(fixture.remainingNonReleaseBackupNames(), ['keep-me']);
  assert.equal(fixture.validBackupCount(), 2);
  assert.equal(fixture.commandLog().includes('docker|system prune'), false);
});

test('retention leaves malformed backup lookalikes untouched', () => {
  const fixture = createFixture({ systemdActive: false, httpHealthy: true, backupKeep: 1 });
  fixture.createBackups([
    '20260820T010101Z-old',
    '20260821T010101Z-old',
    '20abcdefTghijklZ-manual',
    '20260822T010101Z-unsafe label',
    '20260823T010101Z-good',
  ]);
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  assert.equal(fixture.run('rollback').status, 0);
  assert.equal(fixture.validBackupCount(), 1);
  assert.equal(existsSync(path.join(fixture.root, 'backups', '20abcdefTghijklZ-manual')), true);
  assert.equal(existsSync(path.join(fixture.root, 'backups', '20260822T010101Z-unsafe label')), true);
});

test('image retention protects release tags and removes deterministic excess only', () => {
  const fixture = createFixture({
    systemdActive: false,
    httpHealthy: true,
    imageKeep: 3,
    imageList: [
      'other:tag',
      'baby-feed:5555555',
      'baby-feed:2222222',
      'baby-feed:3333333',
      'baby-feed:3333333',
      'baby-feed:1111111',
      'baby-feed:4444444',
    ],
  });
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  const result = fixture.run('rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.match(fixture.commandLog(), /docker\|rmi baby-feed:4444444/);
  assert.match(fixture.commandLog(), /docker\|rmi baby-feed:5555555/);
  assert.doesNotMatch(fixture.commandLog(), /docker\|rmi baby-feed:(1111111|2222222|3333333)/);
  assert.doesNotMatch(fixture.commandLog(), /docker\|rmi other:tag/);
});

test('image listing cleanup failure warns without failing a healthy rollback', () => {
  const fixture = createFixture({ systemdActive: false, httpHealthy: true, dockerImagesFails: true });
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  const result = fixture.run('rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /warning: could not list Docker images for retention/);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:1111111');
});

test('failed rollback start restores the original healthy application without restoring SQLite', () => {
  const fixture = createFixture({ systemdActive: false, httpHealthy: true, composeUpFailures: 1 });
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  const before = fixture.dataDigest();
  const result = fixture.run('rollback');
  assert.notEqual(result.status, 0);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:2222222');
  assert.equal(fixture.releaseValue('PREVIOUS_IMAGE'), 'baby-feed:1111111');
  assert.equal(fixture.dataDigest(), before);
  assert.equal(fixture.backupCount(), 1);
  assert.equal(fixture.commandLog().match(/compose[^\n]*up -d/g)?.length, 2);
  assert.match(fixture.commandLog(), /curl\|--connect-timeout/);
});

test('failed rollback health restores the original healthy application without restoring SQLite', () => {
  const fixture = createFixture({
    systemdActive: false,
    healthSequence: ['unhealthy', 'healthy'],
    httpHealthy: true,
  });
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  const before = fixture.dataDigest();
  const result = fixture.run('rollback');
  assert.notEqual(result.status, 0);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:2222222');
  assert.equal(fixture.releaseValue('PREVIOUS_IMAGE'), 'baby-feed:1111111');
  assert.equal(fixture.dataDigest(), before);
  assert.equal(fixture.backupCount(), 1);
  assert.equal(fixture.commandLog().match(/compose[^\n]*up -d/g)?.length, 2);
  assert.match(fixture.commandLog(), /curl\|--connect-timeout/);
});

test('image removal failure warns without failing a healthy rollback', () => {
  const fixture = createFixture({
    systemdActive: false,
    dockerRmiFails: true,
    httpHealthy: true,
    imageKeep: 1,
    imageList: ['baby-feed:3333333', 'baby-feed:2222222', 'baby-feed:1111111'],
  });
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  const result = fixture.run('rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /warning: could not remove old image baby-feed:3333333/);
  assert.equal(fixture.commandLog().includes('docker|system prune'), false);
});

test('backup retention warns when an early deletion fails but later deletions succeed', () => {
  const fixture = createFixture({
    systemdActive: false,
    backupDeleteFailures: 1,
    backupKeep: 1,
    httpHealthy: true,
  });
  fixture.createBackups([
    '20260820T010101Z-old',
    '20260821T010101Z-old',
    '20260822T010101Z-old',
  ]);
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  const result = fixture.run('rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /warning: could not remove old data backups/);
  assert.equal(fixture.validBackupCount(), 2);
  assert.equal(fixture.commandLog().includes('docker|system prune'), false);
});

test('backup retention warns when backup listing fails without failing a healthy rollback', () => {
  const fixture = createFixture({ systemdActive: false, findFails: true, httpHealthy: true });
  fixture.writeReleaseState('baby-feed:2222222', 'baby-feed:1111111');
  const result = fixture.run('rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /warning: could not list data backups for retention/);
  assert.equal(fixture.releaseValue('CURRENT_IMAGE'), 'baby-feed:1111111');
});
