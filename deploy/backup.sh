#!/usr/bin/env bash
# Kopia zapasowa bazy: pg_dump → plik zaszyfrowany (gpg, AES-256, hasło z pliku) → katalog kopii, opcjonalnie inny serwer.
# Uruchamiany codziennie przez alert-backup.timer (jako root). Ręcznie: sudo /opt/alert-szkolny/deploy/backup.sh
#
# Odtworzenie:
#   gpg --decrypt alert-RRRR-MM-DD-GGMM.dump.gpg > alert.dump
#   sudo -u postgres pg_restore --clean --if-exists --no-owner --role=alert -d alert alert.dump
# Numery telefonów odczytasz tylko z tym samym ENCRYPTION_KEYS i BLIND_INDEX_KEY (.env) – trzymaj ich kopię OSOBNO.
set -euo pipefail

DB_NAME="${DB_NAME:-alert}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/alert-szkolny}"
PASSFILE="${PASSFILE:-/etc/alert-szkolny/backup.pass}"
KEEP_DAYS="${KEEP_DAYS:-30}"
# Drugi serwer (rsync przez SSH), np. kopie@kopie.example.pl:/srv/kopie/alert – puste = tylko ten serwer.
REMOTE="${REMOTE:-}"

if [[ ! -s "$PASSFILE" ]]; then
  echo "Brak pliku z hasłem kopii: $PASSFILE (utwórz: openssl rand -base64 32 > $PASSFILE; chmod 600 $PASSFILE)" >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/alert-$(date +%F-%H%M).dump.gpg"

# Format custom = skompresowany, odtwarzany przez pg_restore.
runuser -u postgres -- pg_dump --format=custom "$DB_NAME" \
  | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSFILE" \
      --symmetric --cipher-algo AES256 --output "$file"

if [[ ! -s "$file" ]]; then
  echo "Kopia jest pusta: $file" >&2
  exit 1
fi

if [[ -n "$REMOTE" ]]; then
  rsync -a "$file" "$REMOTE/"
fi

find "$BACKUP_DIR" -name 'alert-*.dump.gpg' -mtime +"$KEEP_DAYS" -delete
echo "Kopia zapisana: $file ($(du -h "$file" | cut -f1))"
