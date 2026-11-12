#!/usr/bin/env bash
set -Eeuo pipefail
# Run only in an isolated CI checkout: this creates local test commits and replaces origin.
ROOT=$(pwd)
TMP=$(mktemp -d)
cp update.sh "$TMP/update.sh"
git config user.name 'SFMap CI'
git config user.email 'ci@sfmap.invalid'
git clone --bare . "$TMP/origin.git"
git remote set-url origin "$TMP/origin.git"
BASE=$(git rev-parse HEAD)
# Seed real records through the production repository, then simulate an unversioned legacy database.
docker compose stop sfmap
docker compose run --rm --no-deps -T sfmap node --import tsx --input-type=module -e "import {Repository} from './server/repository.ts'; import {db} from './server/db.ts'; import {emptyParticipant} from './shared/participant.ts'; const r=new Repository(); await r.initialize(); await r.mutate('create',{...emptyParticipant,name:'Upgrade participant',locationId:'moscow-137',telegram:'https://t.me/sfmap_ci',plate:'А123АА 777',sunroof:'Да',adminComment:'preserve private data'}); db.exec('DROP TABLE photos; DROP TABLE participant_links; PRAGMA user_version=0'); db.close();"
docker compose up -d --wait --wait-timeout 120
docker compose exec -T sfmap node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync('/app/data/sfmap.sqlite'); const rows=d.prepare('SELECT * FROM participants ORDER BY id').all(); if(rows.length!==1)throw Error('missing seed'); console.log(JSON.stringify(rows));" > "$TMP/before.json"
# Successful fast-forward update from a local origin.
printf '\n' >> README.md
git add README.md
git commit -m 'CI: simulate successful upgrade'
git push origin HEAD:main
GOOD=$(git rev-parse HEAD)
git reset --hard "$BASE"
bash "$TMP/update.sh" "$ROOT"
test "$(git rev-parse HEAD)" = "$GOOD"
docker compose exec -T sfmap node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync('/app/data/sfmap.sqlite'); if(d.prepare('PRAGMA user_version').get().user_version!==2)throw Error('migration not applied'); if(d.prepare('SELECT count(*) AS n FROM participant_links').get().n!==1)throw Error('share link migration not applied'); console.log(JSON.stringify(d.prepare('SELECT * FROM participants ORDER BY id').all()));" > "$TMP/after.json"
cmp "$TMP/before.json" "$TMP/after.json"
# Failing migration actually changes data before throwing, proving backup restoration.
cat > scripts/migrate.ts <<'EOF'
import { db } from '../server/db.ts';
db.exec('DELETE FROM participants; PRAGMA user_version=999');
throw new Error('Intentional CI migration failure');
EOF
git add scripts/migrate.ts
git commit -m 'CI: simulate failed migration'
git push origin HEAD:main
git reset --hard "$GOOD"
if bash "$TMP/update.sh" "$ROOT"; then echo 'Failed migration unexpectedly succeeded' >&2; exit 1; fi
test "$(git rev-parse HEAD)" = "$GOOD"
docker compose exec -T sfmap node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync('/app/data/sfmap.sqlite'); if(d.prepare('PRAGMA user_version').get().user_version!==2)throw Error('schema was not restored'); console.log(JSON.stringify(d.prepare('SELECT * FROM participants ORDER BY id').all()));" > "$TMP/restored.json"
cmp "$TMP/before.json" "$TMP/restored.json"
curl -fsS http://127.0.0.1:18081/api/health | grep -q '"source":"sqlite"'
# Exercise installer remote mode with native TLS and host networking.
docker compose down
password="SFMap-CI-$(openssl rand -hex 16)"
printf '4\n127.0.0.1\n127.0.0.1\n127.0.0.1\n18080\n18081\n2\n%s\n%s\nn\nn\n' "$password" "$password" | bash install.sh
for _ in {1..60}; do
  curl --cacert secrets/tls.crt -fsS https://127.0.0.1:18080/api/health >/dev/null 2>&1 && break
  sleep 1
done
curl --cacert secrets/tls.crt -fsS https://127.0.0.1:18080/api/health | grep -q '"source":"sqlite"'
test "$(curl --cacert secrets/tls.crt -s -o /dev/null -w '%{http_code}' https://127.0.0.1:18080/api/admin/session)" = 401
curl -fsS http://127.0.0.1:18081/api/participants | grep -q 'Upgrade participant'
sed -i 's/^ADMIN_ALLOW_IPS=.*/ADMIN_ALLOW_IPS=203.0.113.10/' .env
docker compose up -d --wait --wait-timeout 120
test "$(curl --cacert secrets/tls.crt -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 203.0.113.10' https://127.0.0.1:18080/api/admin/session)" = 404
# Local installer mode also preserves participants while rotating admin credentials.
docker compose down
printf '1\n18080\n18081\n%s\n%s\n' "$password" "$password" | bash install.sh
curl -fsS http://127.0.0.1:18081/api/participants | grep -q 'Upgrade participant'
