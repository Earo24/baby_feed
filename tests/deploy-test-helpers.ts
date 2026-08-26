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
    if [[ "$*" == *" ps -q app"* ]]; then echo baby-feed-test-container; fi
    ;;
  docker:inspect) echo "\${FAKE_CONTAINER_HEALTH:-healthy}";;
  docker:images) :;;
  docker:rmi) :;;
  systemctl:is-active) [[ "\${FAKE_SYSTEMD_ACTIVE:-1}" == 1 ]];;
  systemctl:*) :;;
  curl:*) [[ "\${FAKE_HTTP_HEALTH:-1}" == 1 ]];;
  chown:*) :;;
  flock:*) [[ "\${FAKE_LOCK_AVAILABLE:-1}" == 1 ]];;
  tar:*)
    if [[ "\${FAKE_TAR_FAIL:-0}" == 1 ]]; then exit 1; fi
    exec /usr/bin/tar "$@"
    ;;
esac
`;

export const fakeCommandNames = ['docker', 'systemctl', 'curl', 'chown', 'flock', 'tar'];

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
