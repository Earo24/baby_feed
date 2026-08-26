import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const shim = `#!/bin/bash
set -Eeuo pipefail
name="$(basename "$0")"
printf '%s|%s\\n' "$name" "$*" >> "$DEPLOY_TEST_LOG"
case "$name:$1" in
  docker:load) cat >/dev/null; echo 'Loaded image';;
  docker:image)
    if [[ "\${2:-}" == inspect ]]; then
      if [[ "$*" == *"--format"* ]]; then
        echo "\${FAKE_IMAGE_ARCH:-amd64}"
      else
        image="\${!#}"
        available=",\${FAKE_AVAILABLE_IMAGES:-baby-feed:1111111,baby-feed:0000000},"
        [[ "$available" == *",$image,"* ]]
      fi
    fi
    ;;
  docker:compose)
    if [[ "$*" == *" stop app"* && "\${FAKE_STOP_FAIL:-0}" == 1 ]]; then exit 1; fi
    if [[ "$*" == *" up -d"* ]]; then
      failures="\${FAKE_COMPOSE_UP_FAILURES:-0}"
      counter_file="\${FAKE_STATE_DIR:-/tmp}/fake-compose-up-count"
      if [[ -f "$counter_file" ]]; then count="$(<"$counter_file")"; else count=0; fi
      if (( count < failures )); then
        printf '%s\n' "$((count + 1))" >"$counter_file"
        exit 1
      fi
    fi
    if [[ "$*" == *" ps -q app"* ]]; then echo baby-feed-test-container; fi
    ;;
  docker:inspect)
    if [[ "$*" == *".Config.Image"* ]]; then
      echo "\${FAKE_RUNNING_IMAGE:-baby-feed:1111111}"
    else
      sequence="\${FAKE_HEALTH_SEQUENCE:-}"
      if [[ -n "$sequence" ]]; then
        counter_file="\${FAKE_STATE_DIR:-/tmp}/fake-health-count"
        if [[ -f "$counter_file" ]]; then count="$(<"$counter_file")"; else count=0; fi
        IFS=',' read -r -a statuses <<< "$sequence"
        index=$((count < \${#statuses[@]} ? count : \${#statuses[@]} - 1))
        printf '%s\n' "$((count + 1))" >"$counter_file"
        echo "\${statuses[$index]}"
      else
        echo "\${FAKE_CONTAINER_HEALTH:-healthy}"
      fi
    fi
  ;;
  docker:ps) [[ "\${FAKE_DOCKER_ACTIVE:-0}" == 1 ]] && echo baby-feed-running;;
  docker:images)
    [[ "\${FAKE_DOCKER_IMAGES_FAIL:-0}" != 1 ]] || exit 1
    printf '%s\n' "\${FAKE_IMAGE_LIST:-}"
    ;;
  docker:rmi)
    [[ "\${FAKE_DOCKER_RMI_FAIL:-0}" != 1 ]] || exit 1
    :
    ;;
  find:*)
    [[ "\${FAKE_FIND_FAIL:-0}" != 1 ]] || exit 1
    exec /usr/bin/find "$@"
    ;;
  rm:*)
    if [[ "\${FAKE_BACKUP_DELETE_FAILURES:-0}" =~ ^[1-9][0-9]*$ && "$*" == *"/backups/"* ]]; then
      counter_file="\${FAKE_STATE_DIR:-/tmp}/fake-backup-rm-count"
      if [[ -f "$counter_file" ]]; then count="$(<"$counter_file")"; else count=0; fi
      if (( count < FAKE_BACKUP_DELETE_FAILURES )); then
        printf '%s\n' "$((count + 1))" >"$counter_file"
        exit 1
      fi
    fi
    exec /bin/rm "$@"
    ;;
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
  'find',
  'rm',
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
