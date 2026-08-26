# Docker Deployment and SQLite Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-command `linux/amd64` Docker deployment workflow that uploads from the local Mac, preserves and backs up the remote SQLite data directory, health-checks releases, and rolls the application back without overwriting data.

**Architecture:** A multi-stage Dockerfile builds Linux-native production dependencies locally through Buildx, then `scripts/deploy.sh` validates, saves, compresses, and uploads the image. `deploy/remote-release.sh` owns the remote critical section: it locks deployment, loads the image before downtime, stops the sole writer, archives the full data directory, switches Compose, verifies `/api/health`, and restores the previous application process on failure.

**Tech Stack:** Bash, Docker Buildx, Docker Compose v2, SSH/SCP, Next.js 16 route handlers, TypeScript 5, Node test runner, better-sqlite3.

---

## File Map

- Create `src/app/api/health/route.ts`: HTTP health endpoint with stable, non-sensitive responses.
- Modify `src/storage/database/sqlite.ts`: expose one repository-owned `checkDatabaseHealth()` query.
- Create `tests/health-api.test.ts`: health success/failure contract.
- Create `Dockerfile`: deterministic `linux/amd64` production image with native `better-sqlite3` and UID/GID 10001.
- Create `.dockerignore`: prevent local dependencies, deployment config, and SQLite files from entering the build context.
- Create `deploy/compose.yaml`: one application service with a host bind mount and health check.
- Create `tests/container-contract.test.ts`: static container/Compose safety contracts.
- Create `deploy/remote-release.sh`: remote preflight, backup, release, rollback, retention, and first systemd migration.
- Create `tests/deploy-test-helpers.ts`: isolated fake command harness for remote and local shell tests.
- Create `tests/remote-release.test.ts`: executable release/backup/rollback tests against temporary directories.
- Create `scripts/deploy.sh`: local `check`, `deploy`, and `rollback` orchestration.
- Create `tests/local-deploy.test.ts`: configuration, command ordering, platform, and upload tests.
- Create `.env.deploy.example`: non-sensitive deployment configuration template.
- Modify `.gitignore`: ignore `.env.deploy` and deployment artifacts.
- Modify `package.json`: add the `pnpm deploy` entry point.
- Create `docs/deployment.md`: setup, daily release, rollback, backup inspection, and explicit database restore runbook.

### Task 1: Add the application and SQLite health contract

**Files:**
- Create: `tests/health-api.test.ts`
- Modify: `src/storage/database/sqlite.ts:158-166`
- Create: `src/app/api/health/route.ts`

- [ ] **Step 1: Write the failing health route test**

Create `tests/health-api.test.ts` with a temporary writable database followed by a path that points at a directory and cannot be opened as a database:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify the missing route failure**

Run:

```bash
pnpm tsx --test tests/health-api.test.ts
```

Expected: FAIL because `src/app/api/health/route.ts` does not exist.

- [ ] **Step 3: Add the repository health query**

Add next to `getDatabase()` in `src/storage/database/sqlite.ts`:

```ts
export function checkDatabaseHealth(): void {
  const result = getDatabase().prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
  if (result?.ok !== 1) throw new Error('SQLite health check failed');
}
```

- [ ] **Step 4: Implement the stable HTTP health response**

Create `src/app/api/health/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@/storage/database/sqlite';

export async function GET() {
  try {
    checkDatabaseHealth();
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'unhealthy' }, { status: 503 });
  }
}
```

- [ ] **Step 5: Run the focused and full tests**

Run:

```bash
pnpm tsx --test tests/health-api.test.ts
pnpm test
```

Expected: both commands PASS; the unhealthy response contains no path or exception text.

- [ ] **Step 6: Commit the health endpoint**

```bash
git add src/storage/database/sqlite.ts src/app/api/health/route.ts tests/health-api.test.ts
git commit -m "feat: add database health endpoint"
```

### Task 2: Add the production image and persistent Compose service

**Files:**
- Create: `tests/container-contract.test.ts`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `deploy/compose.yaml`

- [ ] **Step 1: Write failing container safety contracts**

Create `tests/container-contract.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify the missing-file failure**

Run:

```bash
pnpm tsx --test tests/container-contract.test.ts
```

Expected: FAIL with `ENOENT` for `Dockerfile` or `deploy/compose.yaml`.

- [ ] **Step 3: Create the multi-stage production Dockerfile**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm next build
RUN pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify
RUN pnpm prune --prod

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
ENV COZE_PROJECT_ENV=PROD
ENV HOSTNAME=0.0.0.0
ENV PORT=9001
ENV DEPLOY_RUN_PORT=9001
ENV SQLITE_PATH=/app/data/baby-feed.sqlite
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --gid 10001 baby-feed \
  && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin baby-feed

WORKDIR /app
COPY --from=builder --chown=10001:10001 /app/package.json ./package.json
COPY --from=builder --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /app/.next ./.next
COPY --from=builder --chown=10001:10001 /app/dist ./dist
COPY --from=builder --chown=10001:10001 /app/public ./public
RUN mkdir -p /app/data && chown 10001:10001 /app/data

USER 10001:10001
EXPOSE 9001
CMD ["node", "dist/server.js"]
```

- [ ] **Step 4: Create the build-context exclusions**

Create `.dockerignore`:

```text
.git
.github
.next
.superpowers
.worktrees
node_modules
dist
coverage
data
docs
tests
.env
.env.*
!.env.deploy.example
.env.deploy
*.sqlite*
*.log
*.tgz
*.tar
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 5: Create the Compose service with a host bind mount**

Create `deploy/compose.yaml`:

```yaml
name: baby-feed

services:
  app:
    image: "${BABY_FEED_IMAGE:?BABY_FEED_IMAGE is required}"
    container_name: baby-feed
    restart: unless-stopped
    user: "10001:10001"
    stop_grace_period: 20s
    ports:
      - "${APP_PORT:-9001}:${APP_PORT:-9001}"
    environment:
      NODE_ENV: production
      COZE_PROJECT_ENV: PROD
      HOSTNAME: 0.0.0.0
      PORT: "${APP_PORT:-9001}"
      DEPLOY_RUN_PORT: "${APP_PORT:-9001}"
      SQLITE_PATH: /app/data/baby-feed.sqlite
      NEXT_TELEMETRY_DISABLED: "1"
    volumes:
      - type: bind
        source: ${DATA_DIR:-/opt/baby-feed/data}
        target: /app/data
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
      interval: 2s
      timeout: 2s
      retries: 30
      start_period: 5s
```

- [ ] **Step 6: Verify contracts and Compose rendering**

Run:

```bash
pnpm tsx --test tests/container-contract.test.ts
BABY_FEED_IMAGE=baby-feed:test DATA_DIR=/tmp/baby-feed-test-data APP_PORT=19001 docker compose -f deploy/compose.yaml config --quiet
```

Expected: test PASS and Compose exits 0 without creating containers.

- [ ] **Step 7: Commit the container definition**

```bash
git add Dockerfile .dockerignore deploy/compose.yaml tests/container-contract.test.ts
git commit -m "build: add persistent production container"
```

### Task 3: Implement transactional remote backup and first systemd migration

**Files:**
- Create: `tests/deploy-test-helpers.ts`
- Create: `tests/remote-release.test.ts`
- Create: `deploy/remote-release.sh`

- [ ] **Step 1: Create an isolated fake-command harness**

Create `tests/deploy-test-helpers.ts`. The helper writes command shims into a temporary `bin` directory, logs every invocation, consumes `docker load` stdin, returns a configurable systemd state, returns a configurable container health state, and delegates successful `tar` calls to the real executable:

```ts
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const shim = `#!/bin/bash
set -Eeuo pipefail
name="$(basename "$0")"
printf '%s|%s\\n' "$name" "$*" >> "$DEPLOY_TEST_LOG"
case "$name:$1" in
  docker:load) cat >/dev/null; echo 'Loaded image';;
  docker:image)
    if [[ "${2:-}" == inspect ]]; then echo "${FAKE_IMAGE_ARCH:-amd64}"; fi
    ;;
  docker:compose)
    if [[ "$*" == *" ps -q app"* ]]; then echo baby-feed-test-container; fi
    ;;
  docker:inspect) echo "${FAKE_CONTAINER_HEALTH:-healthy}";;
  docker:images) :;;
  docker:rmi) :;;
  systemctl:is-active) [[ "${FAKE_SYSTEMD_ACTIVE:-1}" == 1 ]];;
  systemctl:*) :;;
  curl:*) [[ "${FAKE_HTTP_HEALTH:-1}" == 1 ]];;
  chown:*) :;;
  flock:*) [[ "${FAKE_LOCK_AVAILABLE:-1}" == 1 ]];;
  tar:*)
    if [[ "${FAKE_TAR_FAIL:-0}" == 1 ]]; then exit 1; fi
    exec /usr/bin/tar "$@"
    ;;
esac
`;

export const fakeCommandNames = [
  'docker',
  'systemctl',
  'curl',
  'chown',
  'flock',
  'tar',
];

export function createFakeCommands(root: string): string {
  const binDirectory = path.join(root, 'bin');
  mkdirSync(binDirectory, { recursive: true });
  for (const name of fakeCommandNames) {
    const filename = path.join(binDirectory, name);
    writeFileSync(filename, shim);
    chmodSync(filename, 0o755);
  }
  return binDirectory;
}
```

- [ ] **Step 2: Write failing executable tests for first deployment**

Create `tests/remote-release.test.ts` with a `runRemoteRelease()` fixture that creates `data/baby-feed.sqlite`, `data/baby-feed.sqlite-wal`, a gzipped fake image archive, a Compose source file, and the fake command directory. Add these exact assertions:

```ts
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
```

The fixture must pass `DEPLOY_DIR` as its temporary root, `APP_PORT=19001`, `HEALTH_TIMEOUT=1`, and prepend the fake bin directory to `PATH`. Use `spawnSync('bash', ['deploy/remote-release.sh', ...args], { env })`. Use `tar -tzf` to implement `backedUpDataNames()` and hash file contents for `dataDigest()`.

- [ ] **Step 3: Run the focused tests and verify the missing script failure**

Run:

```bash
pnpm tsx --test tests/remote-release.test.ts
```

Expected: FAIL because `deploy/remote-release.sh` does not exist.

- [ ] **Step 4: Implement configuration validation, locking, backup, and health helpers**

Create `deploy/remote-release.sh` with strict mode and these concrete interfaces:

```bash
#!/bin/bash
set -Eeuo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/baby-feed}"
APP_PORT="${APP_PORT:-9001}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
IMAGE_KEEP="${IMAGE_KEEP:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-baby-feed}"
DATA_DIR="${DEPLOY_DIR}/data"
STABLE_DIR="${DEPLOY_DIR}/deploy"
BACKUP_DIR="${DEPLOY_DIR}/backups"
INCOMING_DIR="${DEPLOY_DIR}/incoming"
COMPOSE_FILE="${STABLE_DIR}/compose.yaml"
RELEASE_ENV="${STABLE_DIR}/release.env"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[baby-feed] %s\n' "$*"; }
require_uint() { [[ "$2" =~ ^[1-9][0-9]*$ ]] || die "$1 must be a positive integer"; }
TEMP_FILES=()

cleanup_temp_files() {
  local filename
  for filename in "${TEMP_FILES[@]}"; do
    [[ "$filename" == /tmp/* && -f "$filename" ]] && rm -f -- "$filename"
  done
}
trap cleanup_temp_files EXIT

new_temp_file() {
  local variable_name="$1" filename
  filename="$(mktemp)"
  TEMP_FILES+=("$filename")
  printf -v "$variable_name" '%s' "$filename"
}

validate_config() {
  [[ "$DEPLOY_DIR" == /* && "$DEPLOY_DIR" != / ]] || die 'DEPLOY_DIR must be a specific absolute path';
  require_uint APP_PORT "$APP_PORT"
  require_uint BACKUP_KEEP "$BACKUP_KEEP"
  require_uint IMAGE_KEEP "$IMAGE_KEEP"
  require_uint HEALTH_TIMEOUT "$HEALTH_TIMEOUT"
}

compose() {
  docker compose --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE" "$@"
}

acquire_lock() {
  mkdir -p "$DEPLOY_DIR"
  exec 9>"${DEPLOY_DIR}/deploy.lock"
  flock -n 9 || die 'another deployment is already running'
}

release_value() {
  local key="$1" file="${2:-$RELEASE_ENV}"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | head -n 1
}

write_release_env() {
  local current="$1" previous="$2" temporary
  temporary="$(mktemp "${STABLE_DIR}/release.env.XXXXXX")"
  {
    printf 'BABY_FEED_IMAGE=%s\n' "$current"
    printf 'CURRENT_IMAGE=%s\n' "$current"
    printf 'PREVIOUS_IMAGE=%s\n' "$previous"
    printf 'APP_PORT=%s\n' "$APP_PORT"
    printf 'DATA_DIR=%s\n' "$DATA_DIR"
  } > "$temporary"
  mv "$temporary" "$RELEASE_ENV"
}

backup_data() {
  local old_label="$1" timestamp destination partial
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  old_label="${old_label#baby-feed:}"
  old_label="${old_label:-systemd}"
  destination="${BACKUP_DIR}/${timestamp}-${old_label}"
  partial="${destination}.partial.$$"
  mkdir -p "$partial"
  if ! tar -C "$DATA_DIR" -czf "${partial}/data.tar.gz" .; then
    rm -rf -- "$partial"
    return 1
  fi
  [[ -f "$RELEASE_ENV" ]] && cp "$RELEASE_ENV" "${partial}/release.env"
  [[ -f "$COMPOSE_FILE" ]] && cp "$COMPOSE_FILE" "${partial}/compose.yaml"
  printf 'created_at=%s\nprevious_image=%s\n' "$timestamp" "$old_label" > "${partial}/metadata"
  mv "$partial" "$destination"
  printf '%s\n' "$destination"
}

wait_for_health() {
  local deadline container_id status
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    container_id="$(compose ps -q app 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
      if [[ "$status" == healthy ]] && curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}
```

- [ ] **Step 5: Implement `check`, `prepare-upload`, and first-deploy `deploy` flow**

Complete the same script with read-only preflight and upload preparation functions:

```bash
check_environment() {
  local probe="$DEPLOY_DIR"
  command -v docker >/dev/null || die 'docker is required'
  command -v systemctl >/dev/null || die 'systemctl is required'
  command -v gzip >/dev/null || die 'gzip is required'
  command -v tar >/dev/null || die 'tar is required'
  command -v curl >/dev/null || die 'curl is required'
  command -v flock >/dev/null || die 'flock is required'
  docker version --format 'Docker server {{.Server.Version}}'
  docker compose version
  while [[ ! -e "$probe" && "$probe" != / ]]; do probe="$(dirname "$probe")"; done
  [[ -d "$probe" && -w "$probe" ]] || die "deployment parent is not writable: ${probe}"
  df -Pk "$probe"
  if [[ -e "$DATA_DIR" ]]; then
    [[ -d "$DATA_DIR" && -r "$DATA_DIR" ]] || die "data directory is not readable: ${DATA_DIR}"
  fi
  systemctl is-active "$SYSTEMD_SERVICE" || true
  docker ps --filter 'name=^/baby-feed$' --format '{{.Names}} {{.Status}} {{.Ports}}'
  if command -v ss >/dev/null 2>&1; then ss -ltnp | awk -v port=":${APP_PORT}" '$4 ~ port { print }'; fi
}

prepare_upload() {
  mkdir -p "$INCOMING_DIR" "$STABLE_DIR" "$BACKUP_DIR" "$DATA_DIR"
}
```

`deploy IMAGE ARCHIVE COMPOSE_SOURCE` must then use the following release transaction:

```bash
deploy_release() {
  local new_image="$1" archive="$2" compose_source="$3"
  local old_current old_release_copy old_compose_copy mode backup_path architecture
  [[ "$new_image" =~ ^baby-feed:[0-9a-f]{7,40}$ ]] || die 'invalid image tag'
  [[ -f "$archive" && -f "$compose_source" ]] || die 'release artifacts are missing'

  acquire_lock
  old_current="$(release_value CURRENT_IMAGE)"
  mode=systemd
  [[ -n "$old_current" && -f "$COMPOSE_FILE" ]] && mode=docker
  new_temp_file old_release_copy
  new_temp_file old_compose_copy
  [[ -f "$RELEASE_ENV" ]] && cp "$RELEASE_ENV" "$old_release_copy"
  [[ -f "$COMPOSE_FILE" ]] && cp "$COMPOSE_FILE" "$old_compose_copy"

  gzip -t "$archive"
  gzip -dc "$archive" | docker load >/dev/null
  architecture="$(docker image inspect --format '{{.Architecture}}' "$new_image")"
  [[ "$architecture" == amd64 ]] || die "image architecture must be amd64, got ${architecture}"

  if [[ "$mode" == docker ]]; then compose stop app; else systemctl stop "$SYSTEMD_SERVICE"; fi

  if ! backup_path="$(backup_data "$old_current")"; then
    restore_previous_application "$mode" "$old_release_copy" "$old_compose_copy" || true
    die 'database backup failed; previous application restored'
  fi

  if ! {
    chown -R 10001:10001 "$DATA_DIR" \
      && install -m 0644 "$compose_source" "$COMPOSE_FILE" \
      && write_release_env "$new_image" "$old_current" \
      && compose up -d --force-recreate app;
  }; then
    restore_previous_application "$mode" "$old_release_copy" "$old_compose_copy" \
      || die 'release start and automatic application rollback both failed'
    die 'release start failed; previous application restored'
  fi

  if wait_for_health; then
    if [[ "$mode" == systemd ]] && ! systemctl disable "$SYSTEMD_SERVICE"; then
      compose stop app || true
      restore_previous_application "$mode" "$old_release_copy" "$old_compose_copy" \
        || die 'systemd disable failed and the original service could not be restored'
      die 'systemd disable failed; original service restored'
    fi
    log "release healthy: ${new_image}; backup: ${backup_path}"
    rm -f "$archive" "$compose_source"
    return 0
  fi

  compose logs --tail=100 app >&2 || true
  compose stop app || true
  restore_previous_application "$mode" "$old_release_copy" "$old_compose_copy" \
    || die 'new release and automatic application rollback both failed'
  die 'new release failed health checks; previous application restored'
}
```

Define the shared recovery function before `deploy_release()` so every error after downtime restores both the old image state and the Compose definition:

```bash
restore_previous_application() {
  local mode="$1" old_release_copy="$2" old_compose_copy="$3"
  if [[ "$mode" == docker ]]; then
    [[ -s "$old_release_copy" && -s "$old_compose_copy" ]] || return 1
    cp "$old_release_copy" "$RELEASE_ENV"
    cp "$old_compose_copy" "$COMPOSE_FILE"
    compose up -d --force-recreate app
    wait_for_health
  else
    rm -f "$RELEASE_ENV"
    systemctl start "$SYSTEMD_SERVICE"
  fi
}
```

Add this dispatcher so `check` stays read-only and no action accepts an unknown argument shape:

```bash
main() {
  local action="${1:-}"
  validate_config
  case "$action" in
    check)
      [[ "$#" == 1 ]] || die 'usage: remote-release.sh check'
      check_environment
      ;;
    prepare-upload)
      [[ "$#" == 1 ]] || die 'usage: remote-release.sh prepare-upload'
      acquire_lock
      prepare_upload
      ;;
    deploy)
      [[ "$#" == 4 ]] || die 'usage: remote-release.sh deploy IMAGE ARCHIVE COMPOSE_SOURCE'
      deploy_release "$2" "$3" "$4"
      ;;
    rollback)
      die 'rollback is not available until the rollback task is implemented'
      ;;
    *)
      die 'usage: remote-release.sh [check|prepare-upload|deploy|rollback]'
      ;;
  esac
}

main "$@"
```

- [ ] **Step 6: Run syntax and first-deploy tests**

Run:

```bash
bash -n deploy/remote-release.sh
pnpm tsx --test tests/remote-release.test.ts
```

Expected: PASS. The test archive contains both SQLite files and the command log proves load-before-stop and backup-before-Compose ordering.

- [ ] **Step 7: Commit the first remote release transaction**

```bash
git add deploy/remote-release.sh tests/deploy-test-helpers.ts tests/remote-release.test.ts
git commit -m "feat: add transactional remote release"
```

### Task 4: Add Docker-to-Docker rollback and bounded retention

**Files:**
- Modify: `tests/remote-release.test.ts`
- Modify: `deploy/remote-release.sh`

- [ ] **Step 1: Add failing tests for automatic and manual application rollback**

Extend `tests/remote-release.test.ts` with these behaviors:

```ts
test('restores the prior image state without restoring SQLite when health fails', () => {
  const fixture = createFixture({
    systemdActive: false,
    healthSequence: ['unhealthy', 'healthy'],
  });
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
  const fixture = createFixture({
    systemdActive: false,
    httpHealthy: true,
    composeUpFailures: 1,
  });
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
```

Configure the fake health shim so the second `compose up` in the automatic rollback case becomes healthy; implement this with `FAKE_HEALTH_SEQUENCE=unhealthy,healthy` and a counter file in the shim rather than sleeping for the full timeout. Use the same counter-file pattern for `FAKE_COMPOSE_UP_FAILURES=1`, making only the first `docker compose ... up` return nonzero.

- [ ] **Step 2: Run the focused tests and verify rollback/retention failures**

Run:

```bash
pnpm tsx --test tests/remote-release.test.ts
```

Expected: FAIL because `rollback` and retention are not implemented and sequential fake health is unsupported.

- [ ] **Step 3: Implement manual rollback**

Add to `deploy/remote-release.sh`:

```bash
rollback_release() {
  local current previous saved_release backup_path
  acquire_lock
  current="$(release_value CURRENT_IMAGE)"
  previous="$(release_value PREVIOUS_IMAGE)"
  [[ -n "$current" && -n "$previous" ]] || die 'no previous successful Docker image is available'
  docker image inspect "$previous" >/dev/null
  new_temp_file saved_release
  cp "$RELEASE_ENV" "$saved_release"

  compose stop app
  if ! backup_path="$(backup_data "$current")"; then
    compose up -d
    die 'database backup failed; current application restored'
  fi

  write_release_env "$previous" "$current"
  if ! compose up -d --force-recreate app; then
    cp "$saved_release" "$RELEASE_ENV"
    compose up -d --force-recreate app
    wait_for_health || die 'rollback target and original application both failed to start'
    die 'rollback target failed to start; original application restored'
  fi
  if wait_for_health; then
    log "application rolled back to ${previous}; backup: ${backup_path}"
    return 0
  fi

  compose stop app || true
  cp "$saved_release" "$RELEASE_ENV"
  compose up -d --force-recreate app
  wait_for_health || die 'rollback target and original application both failed health checks'
  die 'rollback target failed health checks; original application restored'
}
```

Wire `rollback)` in `main()` to `rollback_release`.

- [ ] **Step 4: Implement narrowly scoped backup and image retention**

Add functions that preserve current and previous tags, remove only valid timestamped backup directories, and target only `baby-feed:*` images:

```bash
cleanup_backups() {
  local -a backups=()
  local remove_count index
  mapfile -t backups < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z-*' -print | sort)
  remove_count=$((${#backups[@]} - BACKUP_KEEP))
  (( remove_count > 0 )) || return 0
  for ((index = 0; index < remove_count; index += 1)); do
    rm -rf -- "${backups[$index]}"
  done
}

cleanup_images() {
  local current previous kept=0 tag
  current="$(release_value CURRENT_IMAGE)"
  previous="$(release_value PREVIOUS_IMAGE)"
  while IFS= read -r tag; do
    [[ -n "$tag" ]] || continue
    if [[ "$tag" == "$current" || "$tag" == "$previous" ]]; then
      kept=$((kept + 1))
    elif (( kept < IMAGE_KEEP )); then
      kept=$((kept + 1))
    else
      docker rmi "$tag" >/dev/null 2>&1 || log "warning: could not remove old image ${tag}"
    fi
  done < <(docker images --filter 'reference=baby-feed:*' --format '{{.Repository}}:{{.Tag}}' | awk '!seen[$0]++')
}
```

Call both cleanup functions only after a healthy deploy or healthy manual rollback. Guard cleanup calls so failures log warnings and never change a successful release result. Update the fake command harness to produce configurable image tags, sequential health results, and a bounded number of Compose start failures.

- [ ] **Step 5: Run remote release tests and shell analysis**

Run:

```bash
bash -n deploy/remote-release.sh
if command -v shellcheck >/dev/null 2>&1; then shellcheck deploy/remote-release.sh; fi
pnpm tsx --test tests/remote-release.test.ts
```

Expected: all commands PASS. The data digest is unchanged during application rollback, invalid backup names remain, and no global prune is called.

- [ ] **Step 6: Commit rollback and retention**

```bash
git add deploy/remote-release.sh tests/deploy-test-helpers.ts tests/remote-release.test.ts
git commit -m "feat: add safe deployment rollback"
```

### Task 5: Add the local one-command deployment driver

**Files:**
- Create: `tests/local-deploy.test.ts`
- Create: `scripts/deploy.sh`
- Create: `.env.deploy.example`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Write failing local-driver tests with fake Git, Docker, SSH, SCP, and pnpm**

Create `tests/local-deploy.test.ts` using the same executable-shim pattern. Assert these exact behaviors:

```ts
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
```

The Docker shim must return success for `info` and `buildx version`, emit fake image bytes for `save`, and log all other calls. The Git shim returns the configured SHA for `rev-parse`, returns nonzero for `diff --quiet` only when `FAKE_GIT_DIRTY=1`, and otherwise succeeds. The SSH shim consumes stdin so streamed remote scripts cannot block tests.

- [ ] **Step 2: Run the tests and verify the missing local script failure**

Run:

```bash
pnpm tsx --test tests/local-deploy.test.ts
```

Expected: FAIL because `scripts/deploy.sh` does not exist.

- [ ] **Step 3: Implement strict configuration and reusable SSH control connection**

Create `scripts/deploy.sh` with strict mode, project-root resolution, `DEPLOY_CONFIG_FILE` override for tests, and these validation primitives:

```bash
#!/bin/bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-${PROJECT_ROOT}/.env.deploy}"
if [[ -f "$DEPLOY_CONFIG_FILE" ]]; then
  set -a
  source "$DEPLOY_CONFIG_FILE"
  set +a
fi

DEPLOY_TARGET="${DEPLOY_TARGET:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/baby-feed}"
APP_PORT="${APP_PORT:-9001}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
IMAGE_KEEP="${IMAGE_KEEP:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[baby-feed] %s\n' "$*"; }
require_uint() { [[ "$2" =~ ^[1-9][0-9]*$ ]] || die "$1 must be a positive integer"; }

validate_config() {
  [[ -n "$DEPLOY_TARGET" ]] || die 'DEPLOY_TARGET is required in .env.deploy'
  [[ "$DEPLOY_DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$DEPLOY_DIR" != / ]] || die 'DEPLOY_DIR is invalid'
  require_uint APP_PORT "$APP_PORT"
  require_uint BACKUP_KEEP "$BACKUP_KEEP"
  require_uint IMAGE_KEEP "$IMAGE_KEEP"
  require_uint HEALTH_TIMEOUT "$HEALTH_TIMEOUT"
}

remote_environment() {
  printf 'DEPLOY_DIR=%q APP_PORT=%q BACKUP_KEEP=%q IMAGE_KEEP=%q HEALTH_TIMEOUT=%q' \
    "$DEPLOY_DIR" "$APP_PORT" "$BACKUP_KEEP" "$IMAGE_KEEP" "$HEALTH_TIMEOUT"
}
```

Create the `mktemp -d` workspace and shared SSH control connection with exact arrays so SSH and SCP authenticate once while credentials remain owned by OpenSSH:

```bash
TEMP_DIR="$(mktemp -d)"
CONTROL_PATH="${TEMP_DIR}/ssh-control"
SSH_OPTIONS=(
  -o StrictHostKeyChecking=yes
  -o ControlMaster=auto
  -o ControlPersist=60
  -o "ControlPath=${CONTROL_PATH}"
)
SCP_OPTIONS=(
  -o StrictHostKeyChecking=yes
  -o ControlMaster=auto
  -o ControlPersist=60
  -o "ControlPath=${CONTROL_PATH}"
)

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -S "$CONTROL_PATH" ]]; then
    ssh "${SSH_OPTIONS[@]}" -O exit "$DEPLOY_TARGET" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TEMP_DIR"
  exit "$status"
}
trap cleanup EXIT INT TERM
```

- [ ] **Step 4: Implement `check`, `deploy`, and `rollback`**

Use the following command sequence in `scripts/deploy.sh`:

```bash
run_remote_streamed() {
  local action="$1"
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_TARGET" \
    "$(remote_environment) bash -s -- ${action}" < "${PROJECT_ROOT}/deploy/remote-release.sh"
}

check_environment() {
  command -v docker >/dev/null || die 'docker is required'
  docker info >/dev/null
  docker buildx version >/dev/null
  command -v ssh >/dev/null || die 'ssh is required'
  command -v scp >/dev/null || die 'scp is required'
  command -v gzip >/dev/null || die 'gzip is required'
  run_remote_streamed check
}

deploy_release() {
  local full_sha short_sha image archive remote_prefix
  git -C "$PROJECT_ROOT" diff --quiet || die 'tracked working tree changes must be committed before deploy'
  git -C "$PROJECT_ROOT" diff --cached --quiet || die 'staged changes must be committed before deploy'
  full_sha="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
  short_sha="${full_sha:0:12}"
  image="baby-feed:${short_sha}"
  archive="${TEMP_DIR}/image-${short_sha}.tar.gz"
  remote_prefix="${DEPLOY_DIR}/incoming/${short_sha}"

  pnpm --dir "$PROJECT_ROOT" test
  pnpm --dir "$PROJECT_ROOT" run validate
  pnpm --dir "$PROJECT_ROOT" run build
  docker buildx build --platform linux/amd64 --load \
    --label "org.opencontainers.image.revision=${full_sha}" \
    -t "$image" "$PROJECT_ROOT"
  docker save "$image" | gzip -c > "$archive"

  run_remote_streamed prepare-upload
  scp "${SCP_OPTIONS[@]}" "$archive" "${DEPLOY_TARGET}:${remote_prefix}-image.tar.gz"
  scp "${SCP_OPTIONS[@]}" "${PROJECT_ROOT}/deploy/compose.yaml" \
    "${DEPLOY_TARGET}:${remote_prefix}-compose.yaml"
  scp "${SCP_OPTIONS[@]}" "${PROJECT_ROOT}/deploy/remote-release.sh" \
    "${DEPLOY_TARGET}:${remote_prefix}-release.sh"
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_TARGET" \
    "$(remote_environment) bash '${remote_prefix}-release.sh' deploy '${image}' '${remote_prefix}-image.tar.gz' '${remote_prefix}-compose.yaml'"
}

case "${1:-deploy}" in
  check) check_environment ;;
  deploy) check_environment; deploy_release ;;
  rollback) check_environment; run_remote_streamed rollback ;;
  *) die 'usage: scripts/deploy.sh [check|deploy|rollback]' ;;
esac
```

Keep paths single-quoted only after validating `DEPLOY_DIR` and the image tag character set. Ensure the cleanup trap never references an unset or broad path.

- [ ] **Step 5: Add configuration template, ignore rule, and package entry**

Create `.env.deploy.example`:

```dotenv
DEPLOY_TARGET=baby-feed-server
DEPLOY_DIR=/opt/baby-feed
APP_PORT=9001
BACKUP_KEEP=10
IMAGE_KEEP=3
HEALTH_TIMEOUT=60
```

Append to `.gitignore`:

```gitignore
# Local deployment target; never commit credentials or host-specific values
.env.deploy
```

Add to `package.json` scripts:

```json
"deploy": "bash ./scripts/deploy.sh deploy"
```

- [ ] **Step 6: Run local-driver and complete shell tests**

Run:

```bash
bash -n scripts/deploy.sh deploy/remote-release.sh
if command -v shellcheck >/dev/null 2>&1; then shellcheck scripts/deploy.sh deploy/remote-release.sh; fi
pnpm tsx --test tests/local-deploy.test.ts tests/remote-release.test.ts
pnpm test
```

Expected: all commands PASS. Fake command logs show a `linux/amd64` SHA-tagged build, upload after validation, and no deployment attempt from a dirty tracked tree.

- [ ] **Step 7: Commit the one-command driver**

```bash
git add scripts/deploy.sh tests/local-deploy.test.ts .env.deploy.example .gitignore package.json
git commit -m "feat: add one-command remote deployment"
```

### Task 6: Verify image architecture, container persistence, and the read-only remote preflight

**Files:**
- Create: `docs/deployment.md`
- Modify only if verification exposes a defect: files introduced in Tasks 1-5 plus their focused tests

- [ ] **Step 1: Write the deployment and explicit restore runbook**

Create `docs/deployment.md` with these commands and safety boundaries:

````markdown
# Baby Feed 部署

## 首次配置

复制 `.env.deploy.example` 为本地 `.env.deploy`，填写 SSH config 别名或 `user@host`。不要把密码、私钥或令牌写入该文件。

```bash
bash scripts/deploy.sh check
```

## 发布与应用回滚

```bash
pnpm deploy
bash scripts/deploy.sh rollback
```

普通发布和应用回滚都会先备份 SQLite，但不会自动恢复数据库备份。

## 检查备份

登录服务器后，只查看明确的 Baby Feed 目录：

```bash
find /opt/baby-feed/backups -mindepth 1 -maxdepth 1 -type d -print | sort
backup_id="${BACKUP_ID:?先把 BACKUP_ID 设置为上面列出的完整目录名}"
[[ "$backup_id" =~ ^20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9._-]+$ ]] || exit 1
backup_archive="/opt/baby-feed/backups/${backup_id}/data.tar.gz"
[[ -f "$backup_archive" ]] || exit 1
tar -tzf "$backup_archive"
```

## 显式恢复数据库

数据库恢复会覆盖当前数据。先停止 Compose、再次归档当前数据、确认备份编号，再恢复完整目录：

```bash
cd /opt/baby-feed
backup_id="${BACKUP_ID:?先把 BACKUP_ID 设置为已检查的完整目录名}"
[[ "$backup_id" =~ ^20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9._-]+$ ]] || exit 1
backup_archive="/opt/baby-feed/backups/${backup_id}/data.tar.gz"
[[ -f "$backup_archive" ]] || exit 1
docker compose --env-file deploy/release.env -f deploy/compose.yaml stop app
recovery_backup="backups/manual-before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0750 "$recovery_backup"
tar -C data -czf "$recovery_backup/data.tar.gz" .
restore_dir="$(mktemp -d /opt/baby-feed/restore.XXXXXX)"
tar -C "$restore_dir" -xzf "$backup_archive"
find data -mindepth 1 -maxdepth 1 -delete
cp -a "$restore_dir"/. data/
chown -R 10001:10001 data
docker compose --env-file deploy/release.env -f deploy/compose.yaml up -d app
rm -rf -- "$restore_dir"
```

Never run the restore block without an exact, listed, and validated `BACKUP_ID`.
````

- [ ] **Step 2: Run the full project validation**

Run:

```bash
pnpm test
pnpm run validate
pnpm run build
git diff --check
```

Expected: all commands PASS with no whitespace errors.

- [ ] **Step 3: Build and inspect the real cross-platform image**

Run:

```bash
image_tag="baby-feed:smoke-$(git rev-parse --short=12 HEAD)"
docker buildx build --platform linux/amd64 --load -t "$image_tag" .
docker image inspect --format '{{.Os}}/{{.Architecture}} {{.Config.User}}' "$image_tag"
```

Expected output:

```text
linux/amd64 10001:10001
```

- [ ] **Step 4: Perform a real local persistence smoke test**

Recompute the deterministic image tag, create an isolated temporary directory, use a non-production port, and install a cleanup trap before starting anything:

```bash
set -Eeuo pipefail
image_tag="baby-feed:smoke-$(git rev-parse --short=12 HEAD)"
smoke_dir="$(mktemp -d)"
cleanup_smoke() {
  set +e
  BABY_FEED_IMAGE="$image_tag" DATA_DIR="$smoke_dir" APP_PORT=19001 docker compose -p baby-feed-smoke -f deploy/compose.yaml down
  docker rmi "$image_tag"
  rm -rf -- "$smoke_dir"
}
trap cleanup_smoke EXIT
chmod 0777 "$smoke_dir"
BABY_FEED_IMAGE="$image_tag" DATA_DIR="$smoke_dir" APP_PORT=19001 docker compose -p baby-feed-smoke -f deploy/compose.yaml up -d
healthy=0
for _ in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:19001/api/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]]
room_json="$(curl --fail --silent -X POST -H 'content-type: application/json' -d '{"name":"部署烟雾测试"}' http://127.0.0.1:19001/api/rooms)"
room_id="$(printf '%s' "$room_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).data.id))")"
BABY_FEED_IMAGE="$image_tag" DATA_DIR="$smoke_dir" APP_PORT=19001 docker compose -p baby-feed-smoke -f deploy/compose.yaml up -d --force-recreate
healthy=0
for _ in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:19001/api/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]]
curl --fail --silent "http://127.0.0.1:19001/api/rooms/${room_id}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);if(!p.success)process.exit(1)})"
```

Expected: final command exits 0 after container recreation. The EXIT trap then removes only project `baby-feed-smoke`, the exact smoke image, and the exact `mktemp` directory.

- [ ] **Step 5: Run the real remote read-only preflight**

Create the ignored `.env.deploy` with the known SSH target but no password, then run:

```bash
bash scripts/deploy.sh check
```

Expected: PASS and report Docker/Compose, free disk, port/service state, and data readability. It must not create a backup, stop systemd, load an image, or start a container.

- [ ] **Step 6: Review the complete diff and commit the runbook or verification fixes**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Commit the runbook and only fixes directly required by failed verification:

```bash
git add docs/deployment.md
git commit -m "docs: add deployment operations runbook"
```

Production deployment is deliberately not part of this plan's automated verification. Running `pnpm deploy` against the real target remains a separate, explicit user action after implementation review.
