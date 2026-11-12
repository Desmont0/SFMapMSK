#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$PROJECT_DIR"
log() { printf '\n[SFMap] %s\n' "$*"; }
die() { printf '\n[SFMap] Ошибка: %s\n' "$*" >&2; exit 1; }
run_root() { if [[ -n "$SUDO" ]]; then "$SUDO" "$@"; else "$@"; fi; }
docker_compose_version() {
  if docker compose version >/dev/null 2>&1; then return 0; fi
  [[ -n "$SUDO" ]] && "$SUDO" docker compose version >/dev/null 2>&1
}

[[ "$(uname -s)" == "Linux" ]] || die "Установщик предназначен для Linux."
if [[ $EUID -eq 0 ]]; then SUDO=""; else command -v sudo >/dev/null 2>&1 || die "Нужен root или sudo."; SUDO=sudo; fi

install_docker() {
  log "Устанавливаю Docker Engine и Compose."
  if command -v apt-get >/dev/null 2>&1; then
    run_root apt-get update
    run_root apt-get install -y ca-certificates curl docker.io docker-compose-v2 || true
    if ! command -v docker >/dev/null 2>&1 || ! docker_compose_version; then
      run_root apt-get install -y docker-compose-plugin || true
    fi
  elif command -v dnf >/dev/null 2>&1; then
    run_root dnf -y install ca-certificates curl docker docker-compose-plugin || true
  elif command -v yum >/dev/null 2>&1; then
    run_root yum -y install ca-certificates curl docker docker-compose-plugin || true
  elif command -v pacman >/dev/null 2>&1; then
    run_root pacman -Sy --noconfirm docker docker-compose
  else
    command -v curl >/dev/null 2>&1 || die "Нужен curl для установки Docker."
    curl -fsSL https://get.docker.com | run_root sh
  fi
  if ! command -v docker >/dev/null 2>&1 || ! docker_compose_version; then
    log "Пакеты дистрибутива не дали Docker Compose v2; использую официальный установщик Docker."
    command -v curl >/dev/null 2>&1 || die "Нужен curl для установки Docker."
    curl -fsSL https://get.docker.com | run_root sh
  fi
}

if ! command -v docker >/dev/null 2>&1 || ! docker_compose_version; then install_docker; fi
command -v docker >/dev/null 2>&1 || die "Docker не найден после установки."

if command -v systemctl >/dev/null 2>&1; then
  run_root systemctl enable --now docker || true
fi

DOCKER_USE_SUDO=0
if ! docker info >/dev/null 2>&1; then
  [[ -n "$SUDO" ]] && "$SUDO" docker info >/dev/null 2>&1 && DOCKER_USE_SUDO=1 || true
fi
docker_cli() {
  if (( DOCKER_USE_SUDO )); then "$SUDO" docker "$@"; else docker "$@"; fi
}
compose() { docker_cli compose "$@"; }

for _ in {1..30}; do
  if docker_cli info >/dev/null 2>&1 && docker_cli compose version >/dev/null 2>&1; then break; fi
  sleep 1
done
docker_cli info >/dev/null 2>&1 || die "Docker daemon не отвечает. Запустите Docker и повторите установку."
docker_cli compose version >/dev/null 2>&1 || die "Docker Compose v2 не найден."
command -v curl >/dev/null 2>&1 || die "Для проверки health нужен curl. Установите curl и повторите установку."

validate_port() {
  local value="$1" name="$2"
  [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] || die "$name должен быть числом от 1 до 65535 без ведущих нулей."
  (( value <= 65535 )) || die "$name должен быть числом от 1 до 65535."
}
validate_ipv4() {
  local value="$1" part
  local -a parts
  [[ "$value" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  IFS=. read -r -a parts <<< "$value"
  for part in "${parts[@]}"; do
    [[ "$part" == 0 || "$part" != 0* ]] || return 1
    (( 10#$part <= 255 )) || return 1
  done
}
port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH 2>/dev/null | awk -v port="$port" '$4 ~ (":" port "$") || $4 ~ ("]:" port "$") { found=1 } END { exit found ? 0 : 1 }'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q .
  else
    return 1
  fi
}

mkdir -p data secrets
run_root chmod 700 data secrets
RUNNING_CONTAINER="$(compose ps --status running -q sfmap 2>/dev/null || true)"
PINNED_VOLUME=""
if [[ -f .sfmap-volume.yaml ]]; then PINNED_VOLUME=:.sfmap-volume.yaml; fi
HOST_BIND=127.0.0.1
ADMIN_ALLOW_IPS=""
DETECTED_HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
ADMIN_ORIGIN_HOST=localhost
ORIGIN_SCHEME=http
TLS_CERT_FILE=
TLS_KEY_FILE=
COOKIE_SECURE=false
COMPOSE_FILE=compose.yaml
printf '\nСетевой режим:\n  1) только локальный доступ\n  2) карта в LAN, админка локально\n  3) публичная карта, админка локально\n  4) удалённая админка только с одного IP, карта публичная\n'
read -r -p 'Выберите 1, 2, 3 или 4 [1]: ' MODE
if [[ -z "$MODE" ]]; then MODE=1; fi
case "$MODE" in
  1) SHARE_BIND=127.0.0.1; MAP_HOST=localhost;;
  2)
    DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    read -r -p "IPv4-адрес LAN для карты [$DETECTED_IP]: " LAN_BIND
    LAN_BIND="${LAN_BIND:-$DETECTED_IP}"
    validate_ipv4 "$LAN_BIND" || die "Нужен адрес IPv4, например 192.168.1.20."
    SHARE_BIND="$LAN_BIND"; MAP_HOST="$LAN_BIND"
    ;;
  3)
    SHARE_BIND=0.0.0.0
    read -r -p 'Домен/IP карты без http:// [localhost]: ' MAP_HOST
    MAP_HOST="${MAP_HOST:-localhost}"
    [[ "$MAP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "Домен/IP карты содержит недопустимые символы."
    ;;
  4)
    HOST_BIND=0.0.0.0
    SHARE_BIND=0.0.0.0
    read -r -p 'Домен/IP карты без http:// [localhost]: ' MAP_HOST
    MAP_HOST="${MAP_HOST:-localhost}"
    [[ "$MAP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "Домен/IP карты содержит недопустимые символы."
    read -r -p 'IPv4-адрес администратора, которому разрешён доступ: ' ADMIN_ALLOW_IP
    validate_ipv4 "$ADMIN_ALLOW_IP" || die "Нужен точный IPv4-адрес администратора, например 203.0.113.10."
    ADMIN_ALLOW_IPS="$ADMIN_ALLOW_IP"
    ADMIN_ORIGIN_HOST_DEFAULT=${DETECTED_HOST_IP:-localhost}
    read -r -p "Домен/IP сервера для ссылки админки [$ADMIN_ORIGIN_HOST_DEFAULT]: " ADMIN_ORIGIN_HOST_INPUT
    ADMIN_ORIGIN_HOST="${ADMIN_ORIGIN_HOST_INPUT:-$ADMIN_ORIGIN_HOST_DEFAULT}"
    [[ "$ADMIN_ORIGIN_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "Домен/IP сервера содержит недопустимые символы."
    ;;
  *) die "Неверный сетевой режим.";;
esac
if [[ "$MODE" == 4 ]]; then COMPOSE_FILE=compose.yaml:compose.remote-admin.yaml; fi
COMPOSE_FILE="$COMPOSE_FILE$PINNED_VOLUME"
read -r -p 'Порт админки [3000]: ' ADMIN_PORT
if [[ -z "$ADMIN_PORT" ]]; then ADMIN_PORT=3000; fi
read -r -p 'Порт публичной карты [3001]: ' SHARE_PORT
if [[ -z "$SHARE_PORT" ]]; then SHARE_PORT=3001; fi
validate_port "$ADMIN_PORT" "Порт админки"
validate_port "$SHARE_PORT" "Порт карты"
[[ "$ADMIN_PORT" != "$SHARE_PORT" ]] || die "Порты должны отличаться."
if [[ "$MODE" == 4 ]]; then
  log 'Для удалённого входа по ключу нужен HTTPS. Сертификат должен быть доверенным на компьютере администратора.'
  printf '  1) готовый сертификат и приватный ключ (PEM)\n  2) самоподписанный сертификат (добавьте его в доверенные на компьютере администратора)\n'
  read -r -p 'Вариант сертификата [1]: ' TLS_MODE
  case "${TLS_MODE:-1}" in
    1)
      read -r -p 'Полный путь к сертификату/fullchain PEM на сервере: ' TLS_SOURCE_CERT
      read -r -p 'Полный путь к приватному ключу PEM: ' TLS_SOURCE_KEY
      run_root test -s "$TLS_SOURCE_CERT" && run_root test -s "$TLS_SOURCE_KEY" || die 'Файлы сертификата или ключа не найдены.'
      ;;
    2) command -v openssl >/dev/null 2>&1 || die 'Для самоподписанного сертификата установите openssl.' ;;
    *) die 'Неверный вариант сертификата.' ;;
  esac
  ORIGIN_SCHEME=https
  COOKIE_SECURE=true
  TLS_CERT_FILE=/app/secrets/tls.crt
  TLS_KEY_FILE=/app/secrets/tls.key
fi
if [[ -z "$RUNNING_CONTAINER" ]] && (port_in_use "$ADMIN_PORT" || port_in_use "$SHARE_PORT"); then
  die "Один из выбранных портов уже занят. Выберите свободные порты."
fi
read -r -s -p 'Пароль администратора (12–1024 символа): ' ADMIN_PASSWORD; printf '\n'
if (( ${#ADMIN_PASSWORD} < 12 || ${#ADMIN_PASSWORD} > 1024 )); then die "Пароль должен содержать от 12 до 1024 символов."; fi
read -r -s -p 'Повторите пароль: ' ADMIN_PASSWORD_CONFIRM; printf '\n'
[[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD_CONFIRM" ]] || die "Пароли не совпадают."

if [[ -n "$RUNNING_CONTAINER" ]]; then
  log "Останавливаю текущий контейнер перед ротацией ключа администратора."
  compose stop sfmap >/dev/null
fi

if [[ -f .env ]]; then
  ENV_BACKUP=".env.$(date +%Y%m%d%H%M%S).bak"
  cp -- .env "$ENV_BACKUP"
  chmod 600 "$ENV_BACKUP"
  log "Предыдущий .env сохранён в $ENV_BACKUP."
fi

# Контейнер запускается с этим UID, чтобы bind-mounted secrets оставался доступен владельцу установки.
if [[ $EUID -eq 0 ]]; then CONTAINER_UID=1000; CONTAINER_GID=1000; else CONTAINER_UID=$(id -u); CONTAINER_GID=$(id -g); fi
run_root chown "$CONTAINER_UID:$CONTAINER_GID" secrets
run_root chmod 700 secrets
if [[ "$MODE" == 4 ]]; then
  if [[ "${TLS_MODE:-1}" == 2 ]]; then
    TLS_SAN="DNS:$ADMIN_ORIGIN_HOST"
    if validate_ipv4 "$ADMIN_ORIGIN_HOST"; then TLS_SAN="IP:$ADMIN_ORIGIN_HOST"; fi
    run_root openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 -subj "/CN=$ADMIN_ORIGIN_HOST" -addext "subjectAltName=$TLS_SAN" -keyout secrets/tls.key -out secrets/tls.crt
  else
    run_root install -m 600 "$TLS_SOURCE_CERT" secrets/tls.crt
    run_root install -m 600 "$TLS_SOURCE_KEY" secrets/tls.key
  fi
  run_root chown "$CONTAINER_UID:$CONTAINER_GID" secrets/tls.crt secrets/tls.key
  run_root chmod 600 secrets/tls.crt secrets/tls.key
fi

cat > .env <<EOF
HOST=0.0.0.0
PORT=$ADMIN_PORT
HOST_BIND=$HOST_BIND
PUBLIC_ORIGIN=$ORIGIN_SCHEME://$ADMIN_ORIGIN_HOST:$ADMIN_PORT
SHARE_PORT=$SHARE_PORT
SHARE_BIND=$SHARE_BIND
SHARE_HOST=0.0.0.0
DATA_DIR=./data
SECRETS_DIR=./secrets
SFMAP_UID=$CONTAINER_UID
SFMAP_GID=$CONTAINER_GID
COMPOSE_FILE=$COMPOSE_FILE
ADMIN_ALLOW_IPS=$ADMIN_ALLOW_IPS
COOKIE_SECURE=$COOKIE_SECURE
TLS_CERT_FILE=$TLS_CERT_FILE
TLS_KEY_FILE=$TLS_KEY_FILE
TELEGRAM_TRANSPORT=proxy
TELEGRAM_PROXY_MODE=external
TELEGRAM_PROXY_FILE=./data/telegram-proxies.json
EOF
chmod 600 .env

log "Собираю SFMap."
compose config --quiet || die 'Проверьте Compose. Для режима 4 нужен Compose >= 2.24.4 с поддержкой !reset.'
compose build
log "Подготавливаю права тома данных и каталога ключей."
compose run --rm --no-deps --user 0 --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE --entrypoint /bin/sh sfmap -c "chown -R $CONTAINER_UID:$CONTAINER_GID /app/data /app/secrets"
printf '%s\n' "$ADMIN_PASSWORD" | compose run --rm --no-deps -T sfmap npm run setup-admin -- --password-stdin
unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM

log "Запускаю SFMap и жду health-check."
compose up -d
HEALTH_HOST="$SHARE_BIND"
[[ "$HEALTH_HOST" == 0.0.0.0 ]] && HEALTH_HOST=127.0.0.1
HEALTH_URL="http://$HEALTH_HOST:$SHARE_PORT/api/health"
for _ in {1..60}; do
  if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1 || { compose ps; compose logs --tail 50 sfmap; die "SFMap не прошёл health-check."; }

if [[ "$MODE" != 1 ]]; then
  read -r -p "Открыть порт карты $SHARE_PORT/tcp в UFW/firewalld? [y/N]: " OPEN_FIREWALL
  if [[ "$OPEN_FIREWALL" =~ ^[Yy]$ ]]; then
    if command -v ufw >/dev/null 2>&1; then run_root ufw allow "$SHARE_PORT/tcp"; fi
    if command -v firewall-cmd >/dev/null 2>&1; then run_root firewall-cmd --permanent --add-port="$SHARE_PORT/tcp"; run_root firewall-cmd --reload; fi
  else
    log "Firewall не изменён. При необходимости откройте только $SHARE_PORT/tcp вручную."
  fi
fi
if [[ "$MODE" == 4 ]]; then
  read -r -p "Открыть порт админки $ADMIN_PORT/tcp только для $ADMIN_ALLOW_IP? [y/N]: " OPEN_ADMIN_FIREWALL
  if [[ "$OPEN_ADMIN_FIREWALL" =~ ^[Yy]$ ]]; then
    if command -v ufw >/dev/null 2>&1; then run_root ufw allow from "$ADMIN_ALLOW_IP" to any port "$ADMIN_PORT" proto tcp; fi
    if command -v firewall-cmd >/dev/null 2>&1; then run_root firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=$ADMIN_ALLOW_IP port port=$ADMIN_PORT protocol=tcp accept"; run_root firewall-cmd --reload; fi
  else
    log "Firewall не изменён. Доступ к админке дополнительно ограничен приложением по IP $ADMIN_ALLOW_IP."
  fi
fi
log "SFMap установлен."
printf 'Карта: http://%s:%s\n' "$MAP_HOST" "$SHARE_PORT"
if [[ "$MODE" == 4 ]]; then
  printf 'Админка: https://%s:%s (разрешён IP: %s)\n' "$ADMIN_ORIGIN_HOST" "$ADMIN_PORT" "$ADMIN_ALLOW_IP"
else
  printf 'Админка: localhost:%s (SSH: ssh -L %s:127.0.0.1:%s user@server)\n' "$ADMIN_PORT" "$ADMIN_PORT" "$ADMIN_PORT"
fi
printf 'Файл доступа: %s/secrets/admin-access.txt\n' "$PROJECT_DIR"
