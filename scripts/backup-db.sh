#!/bin/bash
# Автоматический бэкап БД vbron
# Запускается через cron

set -e

BACKUP_DIR="/home/vitaliyadm/vbron/backups"
CONTAINER="vbron_postgres"
DB_NAME="vbron"
DB_USER="vbron_user"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)   # 1 = понедельник, 7 = воскресенье

# Ежедневный бэкап
DAILY_FILE="$BACKUP_DIR/vbron_daily_$TIMESTAMP.sql.gz"

# Создаём дамп и сжимаем на лету
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists 2>/dev/null | gzip > "$DAILY_FILE"

# Проверяем что файл создался и не пустой
if [ ! -s "$DAILY_FILE" ]; then
    echo "[$(date)] ERROR: Backup файл пустой или не создался" >&2
    rm -f "$DAILY_FILE"
    exit 1
fi

BACKUP_SIZE=$(du -h "$DAILY_FILE" | cut -f1)
echo "[$(date)] Daily backup OK: $DAILY_FILE ($BACKUP_SIZE)"

# Если понедельник (день 1) — делаем weekly копию
if [ "$DAY_OF_WEEK" = "1" ]; then
    WEEKLY_FILE="$BACKUP_DIR/vbron_weekly_$TIMESTAMP.sql.gz"
    cp "$DAILY_FILE" "$WEEKLY_FILE"
    echo "[$(date)] Weekly backup OK: $WEEKLY_FILE"
fi

# Удаляем ежедневные бэкапы старше 7 дней
find "$BACKUP_DIR" -name "vbron_daily_*.sql.gz" -mtime +7 -delete
DAILY_REMAINING=$(find "$BACKUP_DIR" -name "vbron_daily_*.sql.gz" | wc -l)

# Удаляем еженедельные старше 28 дней
find "$BACKUP_DIR" -name "vbron_weekly_*.sql.gz" -mtime +28 -delete
WEEKLY_REMAINING=$(find "$BACKUP_DIR" -name "vbron_weekly_*.sql.gz" | wc -l)

echo "[$(date)] Backups: $DAILY_REMAINING daily, $WEEKLY_REMAINING weekly"
