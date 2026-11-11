#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_DIR"
log() { printf '\n[SFMap] %s\n' "$*"; }
die() { printf '\n[SFMap] Ошибка: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "Установщик предназначен для Linux."
if [[ $EUID -eq 0 ]]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || die "Нужен root или sudo."; SUDO=sudo; fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  log "Устанавливаю Docker Engine и Compose."
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y ca-certificates curl docker.io docker-compose-plugin || $SUDO apt-get install -y docker.io docker-compose
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf -y install docker docker-compose-plugin || $SUDO dnf -y install docker docker-compose
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum -y install docker docker-compose-plugin || $SUDO yum -y install docker docker-compose
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --noconfirm docker docker-compose
  else
    command -v curl >/dev/null 2>&1 || die "Нужен curl для установки Docker."
    curl -fsSL https://get.docker.com | $SUDO sh
  fi
  if command -v systemctl >/dev/null 2>&1; then $SUDO systemctl enable --now docker || true; fi
fi
command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || die "Docker Compose не найден."
compose() { if [[ -n "$SUDO" ]]; then $SUDO docker compose "$@"; else docker compose "$@"; fi; }

mkdir -p data secrets
chmod 700 data secrets || true
printf '\nСетевой режим:\n  1) только локальный доступ\n  2) карта в LAN, админка локально\n  3) публичная карта, админка локально\n'
read -r -p 'Выберите 1, 2 или 3 [1]: ' MODE
if [[ -z "$MODE" ]]; then MODE=1; fi
case "$MODE" in
  1) SHARE_BIND=127.0.0.1; MAP_HOST=localhost;;
  2) SHARE_BIND=0.0.0.0; MAP_HOST=$(hostname -I 2>/dev/null | awk '{print $1}'); if [[ -z "$MAP_HOST" ]]; then MAP_HOST=localhost; fi;;
  3) SHARE_BIND=0.0.0.0; read -r -p 'Домен/IP карты [localhost]: ' MAP_HOST; if [[ -z "$MAP_HOST" ]]; then MAP_HOST=localhost; fi;;
  *) die "Неверный сетевой режим.";;
esac
read -r -p 'Порт админки localhost [3000]: ' ADMIN_PORT
if [[ -z "$ADMIN_PORT" ]]; then ADMIN_PORT=3000; fi
read -r -p 'Порт публичной карты [3001]: ' SHARE_PORT
if [[ -z "$SHARE_PORT" ]]; then SHARE_PORT=3001; fi
[[ "$ADMIN_PORT" != "$SHARE_PORT" ]] || die "Порты должны отличаться."
read -r -s -p 'Пароль администратора (12+ символов): ' ADMIN_PASSWORD; printf '\n'
if [[ $(printf %s "$ADMIN_PASSWORD" | wc -c) -lt 12 ]]; then die "Пароль слишком короткий."; fi
read -r -s -p 'Повторите пароль: ' ADMIN_PASSWORD_CONFIRM; printf '\n'
[[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD_CONFIRM" ]] || die "Пароли не совпадают."

cat > .env <<EOF
HOST=0.0.0.0
PORT=$ADMIN_PORT
HOST_BIND=127.0.0.1
PUBLIC_ORIGIN=http://localhost:$ADMIN_PORT
SHARE_PORT=$SHARE_PORT
SHARE_BIND=$SHARE_BIND
SHARE_HOST=0.0.0.0
DATA_DIR=./data
SECRETS_DIR=./secrets
COOKIE_SECURE=false
TELEGRAM_TRANSPORT=proxy
TELEGRAM_PROXY_MODE=external
TELEGRAM_PROXY_FILE=./data/telegram-proxies.json
EOF
chmod 600 .env

log "Собираю и запускаю SFMap."
compose build
compose up -d
printf '%s\n' "$ADMIN_PASSWORD" | compose run --rm --no-deps -T sfmap npm run setup-admin -- --password-stdin
unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM

if [[ "$MODE" != 1 ]] && command -v ufw >/dev/null 2>&1; then $SUDO ufw allow "$SHARE_PORT/tcp" || true; fi
if [[ "$MODE" != 1 ]] && command -v firewall-cmd >/dev/null 2>&1; then $SUDO firewall-cmd --permanent --add-port="$SHARE_PORT/tcp" || true; $SUDO firewall-cmd --reload || true; fi
log "SFMap установлен."
printf 'Карта: http://%s:%s\n' "$MAP_HOST" "$SHARE_PORT"
printf 'Админка: localhost:%s (SSH: ssh -L %s:127.0.0.1:%s user@server)\n' "$ADMIN_PORT" "$ADMIN_PORT" "$ADMIN_PORT"
printf 'Файл доступа: %s/secrets/admin-access.txt\n' "$PROJECT_DIR"
