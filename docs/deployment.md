# Baby Feed 部署

## 首次配置

复制 `.env.deploy.example` 为本地 `.env.deploy`，填写 SSH config 别名或 `user@host`。不要把密码、私钥或令牌写入该文件。

本页登录服务器后的命令假定 `.env.deploy` 使用默认的 `DEPLOY_DIR=/opt/baby-feed` 和 `APP_PORT=9001`。如果配置覆盖了这两个值，请在手工检查备份或恢复前，将命令中的部署目录、Compose 文件路径和端口统一替换为实际值。

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
set -Eeuo pipefail

restore_dir=""
cleanup_restore() {
  if [[ -n "${restore_dir:-}" && -d "$restore_dir" ]]; then
    rm -rf -- "$restore_dir"
  fi
}
trap cleanup_restore EXIT INT TERM

cd /opt/baby-feed
backup_id="${BACKUP_ID:?先把 BACKUP_ID 设置为已检查的完整目录名}"
[[ "$backup_id" =~ ^20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9._-]+$ ]] || exit 1
backup_archive="/opt/baby-feed/backups/${backup_id}/data.tar.gz"
[[ -f "$backup_archive" ]] || exit 1
tar -tzf "$backup_archive" >/dev/null
docker compose --env-file deploy/release.env -f deploy/compose.yaml stop app
recovery_backup="backups/manual-before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0750 "$recovery_backup"
tar -C data -czf "$recovery_backup/data.tar.gz" .
restore_dir="$(mktemp -d /opt/baby-feed/restore.XXXXXX)"
tar -C "$restore_dir" -xzf "$backup_archive"
[[ -f "$restore_dir/baby-feed.sqlite" ]] || exit 1
find data -mindepth 1 -maxdepth 1 -delete
cp -a "$restore_dir"/. data/
chown -R 10001:10001 data
docker compose --env-file deploy/release.env -f deploy/compose.yaml up -d app
```

Never run the restore block without an exact, listed, and validated `BACKUP_ID`.
