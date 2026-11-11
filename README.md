# SFMap

SFMap — production-карта автомобильного сообщества Москвы и Московской области. Публичная карта показывает опубликованные поля участников, а закрытая админка позволяет добавлять, редактировать и удалять записи. Основное хранилище — встроенная SQLite-база.

## Возможности

- React, MapLibre GL и Express;
- справочник районов Москвы и городов области с проверкой координат;
- SQLite в каталоге DATA_DIR с WAL, транзакциями и защитой от конфликтующих правок;
- отдельные listener-ы для карты и админки;
- админка с одноразовым challenge, Ed25519-подписью, JWE-файлом ключа, scrypt-хешем пароля, HttpOnly-сессией и CSRF;
- локальный кэш Telegram-аватаров WebP 160x160 через безопасный прокси;
- Docker, Docker Compose и пошаговый установщик install.sh для Linux.

## Быстрый запуск на Linux

    chmod +x install.sh
    ./install.sh

Установщик проверит Linux и права администратора, при необходимости установит Docker Engine и Compose v2, затем предложит режим сети: только локальный, карта на выбранном LAN-адресе с локальной админкой или публичная карта с локальной админкой. Он проверяет формат и занятость портов, готовность Docker и health-check приложения. Пароль администратора вводится скрыто и не сохраняется в `.env`; при повторном запуске прежний `.env` сохраняется в резервную копию, а ключ и сессии администратора перевыпускаются.

После запуска установщик показывает адрес карты, путь к `secrets/admin-access.txt`, JWE-файлу и SSH-команду для админки:

    ssh -L 3000:127.0.0.1:3000 user@server

Откройте адрес из `secrets/admin-access.txt` через `http://localhost:3000`. Для входа нужны файл ключа и пароль. Для публичного HTTPS используйте reverse proxy перед listener-ами. Установщик не меняет firewall без отдельного ответа `y`; при выборе LAN или публичного режима откройте только порт карты.

## Ручной запуск

Требуется Node.js 26 и npm:

    npm ci
    cp .env.example .env
    mkdir -p data secrets
    chmod 700 data secrets
    SFMAP_ADMIN_PASSWORD='длинный пароль' npm run setup-admin
    npm run build
    npm start

Для разработки используйте npm run dev. В .env задаются DATA_DIR, SECRETS_DIR, HOST, PORT, PUBLIC_ORIGIN, SHARE_PORT, SHARE_BIND и параметры Telegram. Для HTTPS задайте COOKIE_SECURE=true.

## Docker Compose

    cp .env.example .env
    mkdir -p data secrets
    chmod 700 data secrets
    docker compose build
    docker compose run --rm --no-deps --user 0 --entrypoint /bin/sh sfmap -c 'chown -R 1000:1000 /app/data /app/secrets'
    printf '%s\n' 'длинный пароль' | docker compose run --rm --no-deps -T sfmap npm run setup-admin -- --password-stdin
    docker compose up -d

SQLite и аватарки хранятся в именованном томе sfmap-data, а ./secrets подключается отдельно. Данные и секреты не попадают в образ. Проверка состояния: curl http://127.0.0.1:3000/api/health.

Основной listener использует HOST_BIND:PORT и принимает админские запросы. Публичный listener использует SHARE_BIND:SHARE_PORT и отдаёт только карту и публичный API. В локальном режиме оба адреса привязаны к 127.0.0.1; для LAN или внешнего доступа меняйте SHARE_BIND и открывайте SHARE_PORT в firewall.

## SQLite и резервные копии

Основной файл — data/sfmap.sqlite при ручном запуске или том sfmap-data в Compose. Для согласованной копии выполните `VACUUM INTO` внутри работающего контейнера:

    docker compose exec -T sfmap node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('/app/data/sfmap.sqlite'); db.exec(\"VACUUM INTO '/tmp/sfmap-backup.sqlite'\"); db.close();"
    docker compose cp sfmap:/tmp/sfmap-backup.sqlite ./sfmap.sqlite.backup

Восстановление выполняйте при остановленном контейнере. Резервные копии храните отдельно от сервера.

## Telegram-аватары

Аватары загружаются только с разрешённых Telegram-хостов. По умолчанию используется внешний список HTTP CONNECT, HTTPS CONNECT или SOCKS5 прокси:

    TELEGRAM_TRANSPORT=proxy
    TELEGRAM_PROXY_MODE=external
    TELEGRAM_PROXY_FILE=./data/telegram-proxies.json

Для локального адаптера используйте TELEGRAM_PROXY_MODE=local и `TELEGRAM_LOCAL_PROXY_URL=http://host.docker.internal:8080` в Compose (или адрес адаптера, доступный из контейнера). Обновление списка: npm run proxies:refresh. При ошибке прежняя фотография сохраняется, повтор назначается через 15 минут.

## Проверки

    npm ci
    npm run build
    npm test
    npm audit --audit-level=low

Тесты проверяют географию, валидацию, CRUD SQLite, сохранение после перезапуска, ревизии и откат транзакций, вход по ключу, сессии, CSRF, разграничение listener-ов, очистку устаревших телефонных полей и безопасную обработку Telegram-аватаров.

## Структура данных

- server/db.ts — схема SQLite, настройки, сессии и журнал;
- server/repository.ts — транзакционный репозиторий участников;
- server/auth.ts — challenge, Ed25519/JWE, сессии и CSRF;
- shared/locations.json — справочник мест;
- install.sh — интерактивная установка на Linux;
- compose.yaml и Dockerfile — контейнерный запуск.

Лицензии геоданных и источники указаны в public/geo/LOCATIONS.md и public/geo/SOURCE.md.
