#!/bin/bash
set -Eeuo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/baby-feed}"
APP_PORT="${APP_PORT:-9001}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
IMAGE_KEEP="${IMAGE_KEEP:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-baby-feed}"

set_deploy_paths() {
  DATA_DIR="${DEPLOY_DIR}/data"
  STABLE_DIR="${DEPLOY_DIR}/deploy"
  BACKUP_DIR="${DEPLOY_DIR}/backups"
  INCOMING_DIR="${DEPLOY_DIR}/incoming"
  COMPOSE_FILE="${STABLE_DIR}/compose.yaml"
  RELEASE_ENV="${STABLE_DIR}/release.env"
}

set_deploy_paths

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
  for filename in "${TEMP_FILES[@]-}"; do
    if [[ -f "$filename" && "$filename" == "$STABLE_DIR"/.* ]]; then
      rm -f -- "$filename"
    elif [[ -f "$filename" && "$filename" == /tmp/* ]]; then
      rm -f -- "$filename"
    fi
  done
  return 0
}

trap cleanup_temp_files EXIT

register_temp_file() {
  TEMP_FILES+=("$1")
}

new_stable_temp_file() {
  local variable_name="$1" prefix="$2" filename
  filename="$(mktemp "${STABLE_DIR}/.${prefix}.XXXXXX")"
  register_temp_file "$filename"
  printf -v "$variable_name" '%s' "$filename"
}

validate_config() {
  local canonical managed resolved
  command -v realpath >/dev/null || die 'realpath is required'
  [[ "$DEPLOY_DIR" == /* ]] || die 'DEPLOY_DIR must be a specific absolute path'
  [[ "$DEPLOY_DIR" != *$'\n'* ]] || die 'DEPLOY_DIR must not contain a newline'
  case "/${DEPLOY_DIR#/}/" in
    *"/../"* | *"/./"* | *"//"*) die 'DEPLOY_DIR must not contain traversal components' ;;
  esac
  canonical="$(realpath -m -- "$DEPLOY_DIR")" || die 'DEPLOY_DIR could not be canonicalized'
  [[ "${canonical#/}" == */* ]] || die 'DEPLOY_DIR must be below a specific parent directory'
  case "$canonical" in
    / | /bin | /boot | /dev | /etc | /home | /lib | /lib64 | /opt | /proc | /root | /run | /sbin | /srv | /sys | /tmp | /usr | /usr/local | /var | /var/lib)
      die 'DEPLOY_DIR resolves to an unsafe root'
      ;;
  esac
  if [[ -e "$canonical" ]]; then
    [[ -d "$canonical" && ! -L "$canonical" ]] || die 'DEPLOY_DIR must resolve to a real directory'
  fi
  DEPLOY_DIR="$canonical"
  set_deploy_paths
  for managed in "$DATA_DIR" "$STABLE_DIR" "$BACKUP_DIR" "$INCOMING_DIR"; do
    resolved="$(realpath -m -- "$managed")" || die "managed path could not be canonicalized: ${managed}"
    [[ "$resolved" == "$managed" ]] || die "managed path escapes its exact deployment location: ${managed}"
  done
  require_uint APP_PORT "$APP_PORT"
  require_uint BACKUP_KEEP "$BACKUP_KEEP"
  require_uint IMAGE_KEEP "$IMAGE_KEEP"
  require_uint HEALTH_TIMEOUT "$HEALTH_TIMEOUT"
}

compose_with() {
  local release_file="$1" compose_file="$2"
  shift 2
  docker compose --env-file "$release_file" -f "$compose_file" "$@"
}

stable_compose() {
  compose_with "$RELEASE_ENV" "$COMPOSE_FILE" "$@"
}

candidate_compose() {
  compose_with "$CANDIDATE_RELEASE_ENV" "$CANDIDATE_COMPOSE_FILE" "$@"
}

acquire_lock() {
  local lock_path
  mkdir -p "$DEPLOY_DIR"
  lock_path="${DEPLOY_DIR}/deploy.lock"
  if [[ -L "$lock_path" ]]; then
    die 'deployment lock must not be a symlink'
  fi
  if [[ -e "$lock_path" && ! -f "$lock_path" ]]; then
    die 'deployment lock must be a regular file'
  fi
  if [[ ! -e "$lock_path" ]] && ! (set -o noclobber; : >"$lock_path") 2>/dev/null; then
    [[ -f "$lock_path" && ! -L "$lock_path" ]] || die 'deployment lock could not be created safely'
  fi
  [[ -f "$lock_path" && ! -L "$lock_path" ]] || die 'deployment lock must be a regular file'
  exec 9>>"$lock_path" || die 'deployment lock could not be opened'
  flock -n 9 || die 'another deployment is already running'
}

release_value() {
  local key="$1" file="${2:-$RELEASE_ENV}"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | head -n 1
}

write_release_env_file() {
  local destination="$1" current="$2" previous="$3"
  {
    printf 'BABY_FEED_IMAGE=%s\n' "$current"
    printf 'CURRENT_IMAGE=%s\n' "$current"
    printf 'PREVIOUS_IMAGE=%s\n' "$previous"
    printf 'APP_PORT=%s\n' "$APP_PORT"
    printf 'DATA_DIR=%s\n' "$DATA_DIR"
  } > "$destination"
}

atomic_install() {
  local source="$1" destination="$2" mode="$3" temporary
  temporary="$(mktemp "${STABLE_DIR}/.promote.XXXXXX")" || return 1
  register_temp_file "$temporary"
  if ! install -m "$mode" "$source" "$temporary"; then
    rm -f -- "$temporary"
    return 1
  fi
  if ! mv -f -- "$temporary" "$destination"; then
    rm -f -- "$temporary"
    return 1
  fi
}

snapshot_stable_state() {
  OLD_RELEASE_EXISTS=0
  OLD_COMPOSE_EXISTS=0
  new_stable_temp_file OLD_RELEASE_COPY snapshot-release
  new_stable_temp_file OLD_COMPOSE_COPY snapshot-compose
  if [[ -e "$RELEASE_ENV" || -L "$RELEASE_ENV" ]]; then
    [[ -f "$RELEASE_ENV" && ! -L "$RELEASE_ENV" ]] || die 'stable release.env must be a regular file'
    cp "$RELEASE_ENV" "$OLD_RELEASE_COPY"
    OLD_RELEASE_EXISTS=1
  fi
  if [[ -e "$COMPOSE_FILE" || -L "$COMPOSE_FILE" ]]; then
    [[ -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" ]] || die 'stable compose.yaml must be a regular file'
    cp "$COMPOSE_FILE" "$OLD_COMPOSE_COPY"
    OLD_COMPOSE_EXISTS=1
  fi
}

restore_stable_state() {
  if [[ "$OLD_COMPOSE_EXISTS" == 1 ]]; then
    atomic_install "$OLD_COMPOSE_COPY" "$COMPOSE_FILE" 0644 || return 1
  else
    rm -f -- "$COMPOSE_FILE" || return 1
  fi
  if [[ "$OLD_RELEASE_EXISTS" == 1 ]]; then
    atomic_install "$OLD_RELEASE_COPY" "$RELEASE_ENV" 0600 || return 1
  else
    rm -f -- "$RELEASE_ENV" || return 1
  fi
}

stage_candidate_state() {
  local new_image="$1" old_image="$2" compose_source="$3"
  new_stable_temp_file CANDIDATE_COMPOSE_FILE candidate-compose
  new_stable_temp_file CANDIDATE_RELEASE_ENV candidate-release
  install -m 0644 "$compose_source" "$CANDIDATE_COMPOSE_FILE"
  write_release_env_file "$CANDIDATE_RELEASE_ENV" "$new_image" "$old_image"
}

promote_candidate_state() {
  atomic_install "$CANDIDATE_COMPOSE_FILE" "$COMPOSE_FILE" 0644 || return 1
  atomic_install "$CANDIDATE_RELEASE_ENV" "$RELEASE_ENV" 0600 || return 1
}

cleanup_partial_backup() {
  local partial="$1"
  [[ "$partial" == "$BACKUP_DIR"/*.partial.* ]] || return 1
  rm -rf -- "$partial"
}

backup_data() {
  local old_label="$1" timestamp destination partial
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)" || return 1
  old_label="${old_label#baby-feed:}"
  old_label="${old_label:-systemd}"
  destination="${BACKUP_DIR}/${timestamp}-${old_label}"
  partial="${destination}.partial.$$"
  [[ ! -e "$destination" && ! -L "$destination" ]] || return 1
  mkdir "$partial" || return 1
  if ! tar -C "$DATA_DIR" -czf "${partial}/data.tar.gz" .; then
    cleanup_partial_backup "$partial"
    return 1
  fi
  if [[ -f "$RELEASE_ENV" ]] && ! cp "$RELEASE_ENV" "${partial}/release.env"; then
    cleanup_partial_backup "$partial"
    return 1
  fi
  if [[ -f "$COMPOSE_FILE" ]] && ! cp "$COMPOSE_FILE" "${partial}/compose.yaml"; then
    cleanup_partial_backup "$partial"
    return 1
  fi
  if ! printf 'created_at=%s\nprevious_image=%s\n' "$timestamp" "$old_label" > "${partial}/metadata"; then
    cleanup_partial_backup "$partial"
    return 1
  fi
  if [[ -e "$destination" || -L "$destination" ]]; then
    cleanup_partial_backup "$partial"
    return 1
  fi
  if ! mv -n -- "$partial" "$destination" || [[ -e "$partial" || -L "$partial" ]]; then
    cleanup_partial_backup "$partial"
    return 1
  fi
  printf '%s\n' "$destination"
}

wait_for_health() {
  local release_file="$1" compose_file="$2" deadline remaining container_id status
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  while :; do
    remaining=$((deadline - SECONDS))
    (( remaining > 0 )) || return 1
    container_id="$(compose_with "$release_file" "$compose_file" ps -q app 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
      if [[ "$status" == healthy ]] &&
        curl --connect-timeout "$remaining" --max-time "$remaining" --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null; then
        return 0
      fi
    fi
    sleep 1
  done
}

wait_for_systemd_active() {
  local deadline
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  while :; do
    systemctl is-active "$SYSTEMD_SERVICE" >/dev/null 2>&1 && return 0
    (( SECONDS < deadline )) || return 1
    sleep 1
  done
}

docker_application_is_active() {
  local running
  running="$(docker ps --filter 'name=^/baby-feed$' --filter status=running --format '{{.ID}}' 2>/dev/null || true)"
  ACTIVE_DOCKER_CONTAINER="$running"
  [[ -n "$running" ]]
}

docker_application_is_stopped() {
  local running
  if ! running="$(docker ps --filter 'name=^/baby-feed$' --filter status=running --format '{{.ID}}' 2>/dev/null)"; then
    return 1
  fi
  ACTIVE_DOCKER_CONTAINER="$running"
  [[ -z "$running" ]]
}

stop_compose_application() {
  local release_file="$1" compose_file="$2"
  compose_with "$release_file" "$compose_file" stop app || return 1
  docker_application_is_stopped
}

detect_application_state() {
  local systemd_active=0 docker_active=0 running_image
  systemctl is-active "$SYSTEMD_SERVICE" >/dev/null 2>&1 && systemd_active=1
  docker_application_is_active && docker_active=1
  if [[ "$systemd_active" == 1 && "$docker_active" == 1 ]]; then
    die 'both systemd and Docker applications are active; refusing ambiguous writer state'
  fi
  if [[ "$systemd_active" == 1 ]]; then
    PREDEPLOY_MODE=systemd
    PREDEPLOY_IMAGE=
    return 0
  fi
  if [[ "$docker_active" == 1 ]]; then
    [[ -f "$RELEASE_ENV" && ! -L "$RELEASE_ENV" && -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" ]] ||
      die 'the Docker application is active without complete stable release state'
    PREDEPLOY_IMAGE="$(release_value CURRENT_IMAGE)"
    [[ "$PREDEPLOY_IMAGE" =~ ^baby-feed:[0-9a-f]{7,40}$ ]] ||
      die 'the active Docker application has an invalid stable image tag'
    running_image="$(docker inspect --format '{{.Config.Image}}' "$ACTIVE_DOCKER_CONTAINER" 2>/dev/null)" ||
      die 'the active Docker application image could not be inspected'
    [[ "$running_image" == "$PREDEPLOY_IMAGE" ]] ||
      die 'the active Docker application image conflicts with stable release state'
    PREDEPLOY_MODE=docker
    return 0
  fi
  die 'no active application writer found; refusing to infer state from stale files'
}

stop_current_application() {
  if [[ "$PREDEPLOY_MODE" == systemd ]]; then
    if systemctl stop "$SYSTEMD_SERVICE"; then
      return 0
    fi
    if systemctl is-active "$SYSTEMD_SERVICE" >/dev/null 2>&1; then
      die 'failed to stop systemd; the original application remains active'
    fi
    if systemctl start "$SYSTEMD_SERVICE" && wait_for_systemd_active; then
      die 'systemd stop failed after stopping the service; the original application was restored'
    fi
    die 'systemd stop failed and the original application could not be restored'
  fi

  if stop_compose_application "$RELEASE_ENV" "$COMPOSE_FILE"; then
    return 0
  fi
  if docker_application_is_active; then
    die 'failed to stop Docker; the original application remains active'
  fi
  if stable_compose up -d --force-recreate app && wait_for_health "$RELEASE_ENV" "$COMPOSE_FILE"; then
    die 'Docker stop failed after stopping the app; the original application was restored'
  fi
  die 'Docker stop failed and the original application could not be restored'
}

restore_previous_application() {
  restore_stable_state || return 1
  if [[ "$PREDEPLOY_MODE" == docker ]]; then
    stable_compose up -d --force-recreate app || return 1
    wait_for_health "$RELEASE_ENV" "$COMPOSE_FILE"
  else
    if [[ "${systemd_disabled:-0}" == 1 ]] && ! systemctl enable "$SYSTEMD_SERVICE"; then
      return 1
    fi
    systemctl start "$SYSTEMD_SERVICE" || return 1
    wait_for_systemd_active
  fi
}

cleanup_backups() {
  local -a backups=()
  local remove_count index backup name backup_list_file cleanup_failed=0
  if ! new_stable_temp_file backup_list_file cleanup-backups; then
    return 1
  fi
  if ! find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -print | sort >"$backup_list_file"; then
    return 2
  fi
  while IFS= read -r backup; do
    name="${backup##*/}"
    if [[ "$name" =~ ^20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9._-]+$ ]]; then
      backups+=("$backup")
    fi
  done <"$backup_list_file"
  remove_count=$((${#backups[@]} - BACKUP_KEEP))
  (( remove_count > 0 )) || return 0
  for ((index = 0; index < remove_count; index += 1)); do
    if ! rm -rf -- "${backups[$index]}"; then
      cleanup_failed=1
    fi
  done
  return "$cleanup_failed"
}

cleanup_images() {
  local current previous remaining index tag image_list_file
  local -a protected=() removable=()
  current="$(release_value CURRENT_IMAGE)"
  previous="$(release_value PREVIOUS_IMAGE)"
  if ! new_stable_temp_file image_list_file cleanup-images; then
    log 'warning: could not prepare Docker image retention'
    return 0
  fi
  if ! docker images --filter 'reference=baby-feed:*' --format '{{.Repository}}:{{.Tag}}' |
    sort -u >"$image_list_file"; then
    log 'warning: could not list Docker images for retention'
    return 0
  fi
  while IFS= read -r tag; do
    [[ "$tag" =~ ^baby-feed:[0-9a-f]{7,40}$ ]] || continue
    if [[ "$tag" == "$current" || "$tag" == "$previous" ]]; then
      protected+=("$tag")
    else
      removable+=("$tag")
    fi
  done <"$image_list_file"
  remaining=$((IMAGE_KEEP - ${#protected[@]}))
  if (( remaining < 0 )); then remaining=0; fi
  for ((index = remaining; index < ${#removable[@]}; index += 1)); do
    tag="${removable[$index]}"
    docker rmi "$tag" >/dev/null 2>&1 || log "warning: could not remove old image ${tag}"
  done
}

cleanup_release_artifacts() {
  local backup_status=0
  cleanup_backups || backup_status=$?
  if (( backup_status == 2 )); then
    log 'warning: could not list data backups for retention'
  elif (( backup_status != 0 )); then
    log 'warning: could not remove old data backups'
  fi
  cleanup_images || log 'warning: could not remove old Docker images'
  return 0
}

rollback_release() {
  local current previous saved_release rollback_release_file backup_path
  require_release_directories
  acquire_lock
  detect_application_state
  [[ "$PREDEPLOY_MODE" == docker ]] || die 'manual Docker rollback requires an active Docker application'
  current="$(release_value CURRENT_IMAGE)"
  previous="$(release_value PREVIOUS_IMAGE)"
  [[ "$current" =~ ^baby-feed:[0-9a-f]{7,40}$ ]] || die 'the current release image is invalid'
  [[ "$previous" =~ ^baby-feed:[0-9a-f]{7,40}$ ]] || die 'no previous successful Docker image is available'
  [[ "$previous" != "$current" ]] || die 'no previous successful Docker image is available'
  docker image inspect "$previous" >/dev/null || die 'the previous Docker image is not available locally'

  new_stable_temp_file saved_release rollback-release
  cp "$RELEASE_ENV" "$saved_release"
  if ! stop_compose_application "$RELEASE_ENV" "$COMPOSE_FILE"; then
    if docker_application_is_active; then
      die 'failed to stop Docker; the current application remains active'
    fi
    if stable_compose up -d --force-recreate app && wait_for_health "$RELEASE_ENV" "$COMPOSE_FILE"; then
      die 'Docker stop failed after stopping the app; the current application was restored'
    fi
    die 'Docker stop failed and the current application could not be restored'
  fi

  if ! backup_path="$(backup_data "$current")"; then
    stable_compose up -d --force-recreate app && wait_for_health "$RELEASE_ENV" "$COMPOSE_FILE" ||
      die 'database backup failed and the current application could not be restored'
    die 'database backup failed; current application restored'
  fi

  new_stable_temp_file rollback_release_file rollback-state
  write_release_env_file "$rollback_release_file" "$previous" "$current"
  if ! atomic_install "$rollback_release_file" "$RELEASE_ENV" 0600; then
    stable_compose up -d --force-recreate app && wait_for_health "$RELEASE_ENV" "$COMPOSE_FILE" ||
      die 'rollback state could not be written and the current application could not be restored'
    die 'rollback state could not be written; current application restored'
  fi

  if ! stable_compose up -d --force-recreate app; then
    atomic_install "$saved_release" "$RELEASE_ENV" 0600 ||
      die 'rollback target failed to start and release state could not be restored'
    if ! stable_compose up -d --force-recreate app ||
      ! wait_for_health "$RELEASE_ENV" "$COMPOSE_FILE"; then
      die 'rollback target and original application both failed to start'
    fi
    die 'rollback target failed to start; original application restored'
  fi
  if wait_for_health "$RELEASE_ENV" "$COMPOSE_FILE"; then
    cleanup_release_artifacts
    log "application rolled back to ${previous}; backup: ${backup_path}"
    return 0
  fi

  if ! stop_compose_application "$RELEASE_ENV" "$COMPOSE_FILE"; then
    die 'rollback target failed health checks and could not be stopped; original application was not started'
  fi
  atomic_install "$saved_release" "$RELEASE_ENV" 0600 ||
    die 'rollback target failed health checks and release state could not be restored'
  if ! stable_compose up -d --force-recreate app ||
    ! wait_for_health "$RELEASE_ENV" "$COMPOSE_FILE"; then
    die 'rollback target and original application both failed health checks'
  fi
  die 'rollback target failed health checks; original application restored'
}

validate_incoming_artifact() {
  local label="$1" source="$2" variable_name="$3" canonical
  [[ "$source" == /* && "$source" != *$'\n'* ]] || die "${label} must be an absolute path"
  [[ -f "$source" && ! -L "$source" ]] || die "${label} must be a regular non-symlink file"
  canonical="$(realpath -e -- "$source")" || die "${label} could not be canonicalized"
  [[ "$canonical" == "$INCOMING_DIR"/* ]] || die "${label} must be inside ${INCOMING_DIR}"
  printf -v "$variable_name" '%s' "$canonical"
}

require_release_directories() {
  local directory
  for directory in "$DATA_DIR" "$STABLE_DIR" "$BACKUP_DIR" "$INCOMING_DIR"; do
    [[ -d "$directory" && ! -L "$directory" ]] || die "run prepare-upload before deploy: ${directory}"
  done
}

check_environment() {
  local probe="$DEPLOY_DIR"
  command -v docker >/dev/null || die 'docker is required'
  command -v systemctl >/dev/null || die 'systemctl is required'
  command -v gzip >/dev/null || die 'gzip is required'
  command -v tar >/dev/null || die 'tar is required'
  command -v curl >/dev/null || die 'curl is required'
  command -v flock >/dev/null || die 'flock is required'
  command -v realpath >/dev/null || die 'realpath is required'
  docker version --format 'Docker server {{.Server.Version}}'
  docker compose version
  while [[ ! -e "$probe" && "$probe" != / ]]; do
    probe="$(dirname "$probe")"
  done
  [[ -d "$probe" && -w "$probe" ]] || die "deployment parent is not writable: ${probe}"
  df -Pk "$probe"
  if [[ -e "$DATA_DIR" ]]; then
    [[ -d "$DATA_DIR" && -r "$DATA_DIR" && ! -L "$DATA_DIR" ]] ||
      die "data directory is not a readable real directory: ${DATA_DIR}"
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

recover_after_candidate_failure() {
  stop_compose_application "$CANDIDATE_RELEASE_ENV" "$CANDIDATE_COMPOSE_FILE" || return 2
  restore_previous_application
}

deploy_release() {
  local new_image="$1" archive_argument="$2" compose_argument="$3"
  local archive compose_source backup_path architecture systemd_disabled=0 recovery_status
  [[ "$new_image" =~ ^baby-feed:[0-9a-f]{7,40}$ ]] || die 'invalid image tag'
  require_release_directories
  validate_incoming_artifact 'image archive' "$archive_argument" archive
  validate_incoming_artifact 'Compose source' "$compose_argument" compose_source
  acquire_lock
  detect_application_state
  snapshot_stable_state

  gzip -t "$archive"
  gzip -dc "$archive" | docker load >/dev/null
  architecture="$(docker image inspect --format '{{.Architecture}}' "$new_image")"
  [[ "$architecture" == amd64 ]] || die "image architecture must be amd64, got ${architecture}"
  stage_candidate_state "$new_image" "$PREDEPLOY_IMAGE" "$compose_source"

  stop_current_application
  if ! backup_path="$(backup_data "$PREDEPLOY_IMAGE")"; then
    restore_previous_application || die 'database backup failed and the previous application could not be restored'
    die 'database backup failed; previous application restored'
  fi
  if ! chown -R 10001:10001 "$DATA_DIR"; then
    restore_previous_application || die 'data ownership update failed and the previous application could not be restored'
    die 'data ownership update failed; previous application restored'
  fi
  if ! candidate_compose up -d --force-recreate app; then
    if recover_after_candidate_failure; then
      die 'release start failed; previous application restored'
    else
      recovery_status=$?
    fi
    if (( recovery_status == 2 )); then
      die 'candidate application could not be stopped; previous application was not started'
    fi
    die 'release start and automatic application rollback both failed'
  fi
  if ! wait_for_health "$CANDIDATE_RELEASE_ENV" "$CANDIDATE_COMPOSE_FILE"; then
    candidate_compose logs --tail=100 app >&2 || true
    if recover_after_candidate_failure; then
      die 'new release failed health checks; previous application restored'
    else
      recovery_status=$?
    fi
    if (( recovery_status == 2 )); then
      die 'candidate application could not be stopped; previous application was not started'
    fi
    die 'new release and automatic application rollback both failed'
  fi

  if [[ "$PREDEPLOY_MODE" == systemd ]]; then
    if ! systemctl disable "$SYSTEMD_SERVICE"; then
      if recover_after_candidate_failure; then
        die 'systemd disable failed; original service restored'
      else
        recovery_status=$?
      fi
      if (( recovery_status == 2 )); then
        die 'candidate application could not be stopped; original service was not started'
      fi
      die 'systemd disable failed and the original service could not be restored'
    fi
    systemd_disabled=1
  fi
  if ! promote_candidate_state; then
    if ! stop_compose_application "$CANDIDATE_RELEASE_ENV" "$CANDIDATE_COMPOSE_FILE"; then
      die 'candidate application could not be stopped; previous application was not started'
    fi
    restore_previous_application ||
      die 'stable release promotion failed and the previous application could not be restored'
    die 'stable release promotion failed; previous application restored'
  fi

  log "release healthy: ${new_image}; backup: ${backup_path}"
  cleanup_release_artifacts
  if ! rm -f -- "$archive" "$compose_source"; then
    log 'warning: release succeeded but incoming artifacts could not be removed'
  fi
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
      [[ "$#" == 1 ]] || die 'usage: remote-release.sh rollback'
      rollback_release
      ;;
    *)
      die 'usage: remote-release.sh [check|prepare-upload|deploy|rollback]'
      ;;
  esac
}

main "$@"
