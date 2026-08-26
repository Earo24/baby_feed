#!/bin/bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-${PROJECT_ROOT}/.env.deploy}"
if [[ -f "$DEPLOY_CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$DEPLOY_CONFIG_FILE"
  set +a
fi

DEPLOY_TARGET="${DEPLOY_TARGET:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/baby-feed}"
APP_PORT="${APP_PORT:-9001}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
IMAGE_KEEP="${IMAGE_KEEP:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[baby-feed] %s\n' "$*"
}

require_uint() {
  [[ "$2" =~ ^[1-9][0-9]*$ ]] || die "$1 must be a positive integer"
}

require_port() {
  [[ "$2" =~ ^[1-9][0-9]{0,4}$ ]] || die "$1 must be between 1 and 65535"
  (( 10#$2 <= 65535 )) || die "$1 must be between 1 and 65535"
}

validate_config() {
  [[ -n "$DEPLOY_TARGET" ]] || die 'DEPLOY_TARGET is required in .env.deploy'
  [[ "$DEPLOY_TARGET" != -* && "$DEPLOY_TARGET" != *$'\n'* && "$DEPLOY_TARGET" != *' '* ]] ||
    die 'DEPLOY_TARGET is invalid'
  [[ "$DEPLOY_DIR" =~ ^/[A-Za-z0-9._/-]+$ && "$DEPLOY_DIR" != / ]] ||
    die 'DEPLOY_DIR is invalid'
  if [[ "$DEPLOY_DIR" == *'//'* || "$DEPLOY_DIR" == *'/../'* || "$DEPLOY_DIR" == *'/./'* ||
    "$DEPLOY_DIR" == */.. || "$DEPLOY_DIR" == */. ]]; then
    die 'DEPLOY_DIR is invalid'
  fi
  require_port APP_PORT "$APP_PORT"
  require_uint BACKUP_KEEP "$BACKUP_KEEP"
  require_uint IMAGE_KEEP "$IMAGE_KEEP"
  require_uint HEALTH_TIMEOUT "$HEALTH_TIMEOUT"
}

shell_quote() {
  printf '%q' "$1"
}

remote_environment() {
  printf 'DEPLOY_DIR=%q APP_PORT=%q BACKUP_KEEP=%q IMAGE_KEEP=%q HEALTH_TIMEOUT=%q' \
    "$DEPLOY_DIR" "$APP_PORT" "$BACKUP_KEEP" "$IMAGE_KEEP" "$HEALTH_TIMEOUT"
}

validate_config

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

run_remote_streamed() {
  local action="$1"
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_TARGET" \
    "$(remote_environment) bash -s -- ${action}" < "${PROJECT_ROOT}/deploy/remote-release.sh"
}

check_environment() {
  command -v docker >/dev/null || die 'docker is required'
  docker info >/dev/null || die 'docker daemon is unavailable'
  docker buildx version >/dev/null || die 'docker buildx is required'
  command -v git >/dev/null || die 'git is required'
  command -v pnpm >/dev/null || die 'pnpm is required'
  command -v ssh >/dev/null || die 'ssh is required'
  command -v scp >/dev/null || die 'scp is required'
  command -v gzip >/dev/null || die 'gzip is required'
  run_remote_streamed check
}

deploy_release() {
  local full_sha short_sha image archive remote_prefix untracked

  git -C "$PROJECT_ROOT" diff --quiet || die 'tracked working tree changes must be committed before deploy'
  git -C "$PROJECT_ROOT" diff --cached --quiet || die 'staged changes must be committed before deploy'
  untracked="$(git -C "$PROJECT_ROOT" ls-files --others --exclude-standard)"
  [[ -z "$untracked" ]] || die 'non-ignored untracked files must be committed before deploy'

  full_sha="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
  [[ "$full_sha" =~ ^[0-9a-fA-F]{12,64}$ ]] || die 'git commit SHA is invalid'
  short_sha="${full_sha:0:12}"
  image="baby-feed:${short_sha}"
  archive="${TEMP_DIR}/image-${short_sha}.tar.gz"
  remote_prefix="${DEPLOY_DIR}/incoming/${short_sha}"

  log "testing commit ${full_sha}"
  pnpm --dir "$PROJECT_ROOT" test
  pnpm --dir "$PROJECT_ROOT" run validate
  pnpm --dir "$PROJECT_ROOT" run build

  log "building ${image} for linux/amd64"
  docker buildx build --platform linux/amd64 --load \
    --label "org.opencontainers.image.revision=${full_sha}" \
    -t "$image" "$PROJECT_ROOT"
  docker save "$image" | gzip -c > "$archive"

  run_remote_streamed prepare-upload
  scp "${SCP_OPTIONS[@]}" "$archive" "${DEPLOY_TARGET}:${remote_prefix}-image.tar.gz"
  scp "${SCP_OPTIONS[@]}" "${PROJECT_ROOT}/deploy/compose.yaml" \
    "${DEPLOY_TARGET}:${remote_prefix}-compose.yaml"
  scp "${SCP_OPTIONS[@]}" "${PROJECT_ROOT}/deploy/remote-release.sh" \
    "${DEPLOY_TARGET}:${remote_prefix}-compose-release.sh"

  local remote_script remote_image remote_archive remote_compose
  remote_script="$(shell_quote "${remote_prefix}-compose-release.sh")"
  remote_image="$(shell_quote "$image")"
  remote_archive="$(shell_quote "${remote_prefix}-image.tar.gz")"
  remote_compose="$(shell_quote "${remote_prefix}-compose.yaml")"
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_TARGET" \
    "$(remote_environment) bash ${remote_script} deploy ${remote_image} ${remote_archive} ${remote_compose}"
}

case "${1:-deploy}" in
  check)
    [[ "$#" == 1 ]] || die 'usage: scripts/deploy.sh [check|deploy|rollback]'
    check_environment
    ;;
  deploy)
    [[ "$#" == 1 ]] || die 'usage: scripts/deploy.sh [check|deploy|rollback]'
    check_environment
    deploy_release
    ;;
  rollback)
    [[ "$#" == 1 ]] || die 'usage: scripts/deploy.sh [check|deploy|rollback]'
    check_environment
    run_remote_streamed rollback
    ;;
  *)
    die 'usage: scripts/deploy.sh [check|deploy|rollback]'
    ;;
esac
