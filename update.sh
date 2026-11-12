#!/usr/bin/env bash
set -Eeuo pipefail
# Parse the complete body before Git replaces this script during an upgrade.
main() {
  umask 077
  PROJECT_DIR="$(cd -- "${1:-$(dirname -- "$0")}" && pwd)"
  cd "$PROJECT_DIR"
  log() { printf '\n[SFMap] %s\n' "$*"; }
  die() { printf '\n[SFMap] Ошибка: %s\n' "$*" >&2; exit 1; }
  [[ "$(uname -s)" == Linux ]] || die 'Обновление предназначено для Linux.'
  for cmd in git docker flock tar cmp; do command -v "$cmd" >/dev/null || die "Не найдена команда $cmd."; done
  [[ -f .env && -f compose.yaml ]] || die 'Нужна существующая установка SFMap с .env и compose.yaml.'
  [[ -z "$(git status --porcelain --untracked-files=normal -- . ':!backups/' ':!.sfmap-update.lock' ':!.sfmap-volume.yaml')" ]] || die 'Git checkout содержит изменения. Сохраните их перед обновлением.'
  exec 9>.sfmap-update.lock
  flock -n 9 || die 'Другое обновление уже запущено.'
  DOCKER_SUDO=()
  if ! docker info >/dev/null 2>&1; then
    command -v sudo >/dev/null || die 'Нет доступа к Docker; нужен sudo.'
    sudo docker info >/dev/null || die 'Docker daemon недоступен.'
    DOCKER_SUDO=(sudo)
  fi
  docker_cli() { "${DOCKER_SUDO[@]}" docker "$@"; }
  compose() { docker_cli compose "$@"; }
  compose version >/dev/null || die 'Нужен Docker Compose v2.'
  compose config --quiet
  OLD_SHA=$(git rev-parse HEAD)
  BRANCH=${SFMAP_BRANCH:-main}
  log "Получаю origin/$BRANCH."
  git fetch origin "$BRANCH"
  TARGET_SHA=$(git rev-parse FETCH_HEAD)
  git merge-base --is-ancestor "$OLD_SHA" "$TARGET_SHA" || die 'Обновление должно быть fast-forward.'
  CONTAINER_ID=$(compose ps -aq sfmap | head -n 1)
  [[ -n "$CONTAINER_ID" ]] || die 'Контейнер установки не найден. Запустите прежнюю версию из её исходного каталога; обновление не создаёт пустую базу.'
  DATA_VOLUME=$(docker_cli inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$CONTAINER_ID")
  [[ -n "$DATA_VOLUME" ]] || die 'Не найден именованный том /app/data. Для ручной установки используйте инструкции README.'
  OLD_IMAGE=$(docker_cli inspect -f '{{.Image}}' "$CONTAINER_ID")
  OLD_USER=$(docker_cli inspect -f '{{.Config.User}}' "$CONTAINER_ID")
  BACKUP_DIR="$PROJECT_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$PROJECT_DIR/backups" "$BACKUP_DIR"
  compose config > "$BACKUP_DIR/compose.yaml"
  cp .env "$BACKUP_DIR/env"
  printf '%s\n' "$OLD_SHA" > "$BACKUP_DIR/commit"
  printf '%s\n' "$DATA_VOLUME" > "$BACKUP_DIR/volume"
  ROLLBACK_IMAGE="sfmap-rollback:$(date -u +%Y%m%d%H%M%S)-$$"
  docker_cli tag "$OLD_IMAGE" "$ROLLBACK_IMAGE"
  printf 'services:\n  sfmap:\n    image: %s\n' "$ROLLBACK_IMAGE" > "$BACKUP_DIR/image.yaml"
  old_compose() { docker_cli compose --project-directory "$PROJECT_DIR" -f "$BACKUP_DIR/compose.yaml" -f "$BACKUP_DIR/image.yaml" "$@"; }
  old_node() {
    docker_cli run --rm -i --network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --user "${OLD_USER:-1000:1000}" --mount "type=volume,src=$DATA_VOLUME,dst=/app/data" --entrypoint node "$ROLLBACK_IMAGE" --input-type=module "$@"
  }
  fingerprint() {
    old_node -e "import {DatabaseSync} from 'node:sqlite'; import {createHash} from 'node:crypto'; const d=new DatabaseSync('/app/data/sfmap.sqlite',{readOnly:true}); if(d.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite integrity check failed'); const ids=d.prepare('SELECT id FROM participants ORDER BY id').all(); const admin=d.prepare(\"SELECT value FROM settings WHERE key='admin'\").get(); console.log(JSON.stringify({count:ids.length,ids:createHash('sha256').update(JSON.stringify(ids)).digest('hex'),admin:createHash('sha256').update(JSON.stringify(admin||null)).digest('hex')})); d.close();"
  }
  STOPPED=0; BACKUP_READY=0; GIT_UPDATED=0
  rollback() {
    local code=$?
    trap - EXIT
    if (( code != 0 && STOPPED )); then
      log "Сбой обновления. Восстанавливаю прежнюю версию; копия: $BACKUP_DIR"
      if ! old_compose stop sfmap; then log 'Не удалось остановить новую версию. Восстановление базы отменено.'; exit "$code"; fi
      if (( GIT_UPDATED )) && ! git reset --hard "$OLD_SHA"; then log 'Не удалось вернуть Git commit. Сервис остановлен.'; exit "$code"; fi
      if (( BACKUP_READY )); then
        if ! old_node -e "import fs from 'node:fs'; const chunks=[]; for await(const c of process.stdin)chunks.push(c); fs.writeFileSync('/app/data/sfmap-restore.tmp',Buffer.concat(chunks),{mode:0o600}); for(const suffix of ['-wal','-shm'])fs.rmSync('/app/data/sfmap.sqlite'+suffix,{force:true}); fs.renameSync('/app/data/sfmap-restore.tmp','/app/data/sfmap.sqlite');" < "$BACKUP_DIR/database.sqlite"; then
          log 'Не удалось восстановить SQLite. Сервис остановлен. Сохраните каталог резервной копии.'; exit "$code"
        fi
      fi
      cp "$BACKUP_DIR/env" .env
      if old_compose up -d --no-build --pull never --wait --wait-timeout 120; then
        log 'Прежняя версия и база восстановлены.'
      else
        old_compose stop sfmap || true
        log 'Не удалось запустить прежний образ. Сервис остановлен; требуется восстановление из указанной копии.'
      fi
    fi
    exit "$code"
  }
  trap rollback EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  log 'Останавливаю запись и создаю согласованную резервную копию SQLite.'
  STOPPED=1
  compose stop sfmap
  fingerprint > "$BACKUP_DIR/before.json"
  old_node -e "import {DatabaseSync} from 'node:sqlite'; import fs from 'node:fs'; const d=new DatabaseSync('/app/data/sfmap.sqlite'); d.exec(\"VACUUM INTO '/tmp/snapshot.sqlite'\"); d.close(); process.stdout.write(fs.readFileSync('/tmp/snapshot.sqlite'));" > "$BACKUP_DIR/database.sqlite"
  [[ -s "$BACKUP_DIR/database.sqlite" ]] || die 'Не удалось создать резервную копию базы.'
  BACKUP_READY=1
  if [[ -r secrets/admin-access.txt ]]; then
    tar -czf "$BACKUP_DIR/secrets.tar.gz" secrets
  else
    command -v sudo >/dev/null || die 'Нужен sudo для резервного копирования secrets.'
    sudo tar -czf - secrets > "$BACKUP_DIR/secrets.tar.gz"
  fi
  GIT_UPDATED=1
  git merge --ff-only "$TARGET_SHA"
  compose config --quiet
  # Pin the actual existing volume, including on future runs and after a directory rename.
  printf 'volumes:\n  sfmap-data:\n    external: true\n    name: %s\n' "$DATA_VOLUME" > .sfmap-volume.yaml
  COMPOSE_PATHS=$(sed -n 's/^COMPOSE_FILE=//p' .env | tail -n 1)
  COMPOSE_PATHS=${COMPOSE_PATHS:-compose.yaml}
  if [[ ":$COMPOSE_PATHS:" != *:.sfmap-volume.yaml:* ]]; then COMPOSE_PATHS="$COMPOSE_PATHS:.sfmap-volume.yaml"; fi
  if grep -q '^COMPOSE_FILE=' .env; then sed -i "s|^COMPOSE_FILE=.*|COMPOSE_FILE=$COMPOSE_PATHS|" .env; else printf 'COMPOSE_FILE=%s\n' "$COMPOSE_PATHS" >> .env; fi
  export COMPOSE_FILE="$COMPOSE_PATHS"
  log 'Собираю новую версию и применяю миграции.'
  compose build
  compose run --rm --no-deps -T sfmap npm run db:migrate
  fingerprint > "$BACKUP_DIR/after.json"
  cmp -s "$BACKUP_DIR/before.json" "$BACKUP_DIR/after.json" || die 'Изменился состав участников или ключ администратора.'
  compose up -d --no-build --wait --wait-timeout 120
  compose exec -T sfmap node --input-type=module -e "const r=await fetch('http://127.0.0.1:'+(process.env.SHARE_PORT||3001)+'/api/health'); const j=await r.json(); if(!r.ok||j.source!=='sqlite')process.exit(1);"
  STOPPED=0
  trap - EXIT INT TERM
  log "Обновление завершено. База и доступ администратора сохранены. Резервная копия: $BACKUP_DIR"
}
main "$@"; exit
