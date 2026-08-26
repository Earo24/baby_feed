import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const shim = `#!/bin/bash
set -Eeuo pipefail
name="$(basename "$0")"
printf '%s|%s\\n' "$name" "$*" >> "$DEPLOY_TEST_LOG"
case "$name:$1" in
  docker:load) cat >/dev/null; echo 'Loaded image';;
  docker:image)
    if [[ "\${2:-}" == inspect ]]; then echo "\${FAKE_IMAGE_ARCH:-amd64}"; fi
    ;;
  docker:compose)
    if [[ "$*" == *" stop app"* && "\${FAKE_STOP_FAIL:-0}" == 1 ]]; then exit 1; fi
    if [[ "$*" == *" ps -q app"* ]]; then echo baby-feed-test-container; fi
    ;;
  docker:inspect)
    if [[ "$*" == *".Config.Image"* ]]; then
      echo "\${FAKE_RUNNING_IMAGE:-baby-feed:1111111}"
    else
      echo "\${FAKE_CONTAINER_HEALTH:-healthy}"
    fi
    ;;
  docker:ps) [[ "\${FAKE_DOCKER_ACTIVE:-0}" == 1 ]] && echo baby-feed-running;;
  docker:images) :;;
  docker:rmi) :;;
  systemctl:is-active) [[ "\${FAKE_SYSTEMD_ACTIVE:-1}" == 1 ]];;
  systemctl:stop) [[ "\${FAKE_STOP_FAIL:-0}" != 1 ]];;
  systemctl:*) :;;
  curl:*)
    if [[ -n "\${EXPECT_STABLE_IMAGE_DURING_HEALTH:-}" ]]; then
      grep -qx "CURRENT_IMAGE=\${EXPECT_STABLE_IMAGE_DURING_HEALTH}" "\${STABLE_RELEASE_ENV}" || exit 1
    fi
    if [[ -n "\${EXPECT_STABLE_COMPOSE_MARKER:-}" ]]; then
      grep -Fqx "\${EXPECT_STABLE_COMPOSE_MARKER}" "\${STABLE_COMPOSE_FILE}" || exit 1
    fi
    [[ "\${FAKE_HTTP_HEALTH:-1}" == 1 ]]
    ;;
  chown:*) :;;
  flock:*) [[ "\${FAKE_LOCK_AVAILABLE:-1}" == 1 ]];;
  tar:*)
    if [[ "\${FAKE_TAR_FAIL:-0}" == 1 ]]; then exit 1; fi
    exec /usr/bin/tar "$@"
    ;;
  mv:*)
    if [[ "\${FAKE_BACKUP_FINALIZE_FAIL:-0}" == 1 && "$*" == *".partial."* ]]; then exit 1; fi
    exec /bin/mv "$@"
    ;;
  date:*)
    if [[ -n "\${FAKE_TIMESTAMP:-}" ]]; then echo "\${FAKE_TIMESTAMP}"; else exec /bin/date "$@"; fi
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
  'mv',
  'date',
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
