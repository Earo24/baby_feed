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

TEMP_FILES=()

cleanup_temp_files() {
  local filename
  for filename in "${TEMP_FILES[@]}"; do
    [[ "$filename" == /tmp/* && -f "$filename" ]] && rm -f -- "$filename"
  done
  return 0
}

trap cleanup_temp_files EXIT

new_temp_file() {
  local variable_name="$1" filename
  filename="$(mktemp)"
  TEMP_FILES+=("$filename")
  printf -v "$variable_name" '%s' "$filename"
}

validate_config() {
  [[ "$DEPLOY_DIR" == /* && "$DEPLOY_DIR" != / ]] || die 'DEPLOY_DIR must be a specific absolute path'
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
  while [[ ! -e "$probe" && "$probe" != / ]]; do
    probe="$(dirname "$probe")"
  done
  [[ -d "$probe" && -w "$probe" ]] || die "deployment parent is not writable: ${probe}"
  df -Pk "$probe"
  if [[ -e "$DATA_DIR" ]]; then
    [[ -d "$DATA_DIR" && -r "$DATA_DIR" ]] || die "data directory is not readable: ${DATA_DIR}"
  fi
  systemctl is-active "$SYSTEMD_SERVICE" || true
  docker ps --filter 'name=^/baby-feed$' --format '{{.Names}} {{.Status}} {{.Ports}}'
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp | awk -v port=":${APP_PORT}" '$4 ~ port { print }'
  fi
}

prepare_upload() {
  mkdir -p "$INCOMING_DIR" "$STABLE_DIR" "$BACKUP_DIR" "$DATA_DIR"
}

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
  if [[ "$mode" == docker ]]; then
    compose stop app
  else
    systemctl stop "$SYSTEMD_SERVICE"
  fi
  if ! backup_path="$(backup_data "$old_current")"; then
    restore_previous_application "$mode" "$old_release_copy" "$old_compose_copy" || true
    die 'database backup failed; previous application restored'
  fi
  if ! {
    chown -R 10001:10001 "$DATA_DIR" &&
      install -m 0644 "$compose_source" "$COMPOSE_FILE" &&
      write_release_env "$new_image" "$old_current" &&
      compose up -d --force-recreate app
  }; then
    restore_previous_application "$mode" "$old_release_copy" "$old_compose_copy" || die 'release start and automatic application rollback both failed'
    die 'release start failed; previous application restored'
  fi
  if wait_for_health; then
    if [[ "$mode" == systemd ]] && ! systemctl disable "$SYSTEMD_SERVICE"; then
      compose stop app || true
      restore_previous_application "$mode" "$old_release_copy" "$old_compose_copy" || die 'systemd disable failed and the original service could not be restored'
      die 'systemd disable failed; original service restored'
    fi
    log "release healthy: ${new_image}; backup: ${backup_path}"
    rm -f "$archive" "$compose_source"
    return 0
  fi
  compose logs --tail=100 app >&2 || true
  compose stop app || true
  restore_previous_application "$mode" "$old_release_copy" "$old_compose_copy" || die 'new release and automatic application rollback both failed'
  die 'new release failed health checks; previous application restored'
}

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
