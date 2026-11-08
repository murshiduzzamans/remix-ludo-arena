#!/usr/bin/env bash
# Backup D1 database using wrangler d1 export
# Run this script regularly to backup your production database

set -e

ENVIRONMENT="${1:-production}"
BACKUP_DIR="backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/ludo-arena-$ENVIRONMENT-$TIMESTAMP.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Backing up $ENVIRONMENT database..."

if [ "$ENVIRONMENT" = "staging" ]; then
    DB_NAME="ludo-arena-staging-db"
    npx wrangler d1 export "$DB_NAME" --env staging --output "$BACKUP_FILE"
elif [ "$ENVIRONMENT" = "production" ]; then
    DB_NAME="ludo-arena-prod-db"
    npx wrangler d1 export "$DB_NAME" --env production --output "$BACKUP_FILE"
else
    echo "Error: Environment must be 'staging' or 'production'"
    exit 1
fi

echo "✓ Backup saved to: $BACKUP_FILE"

# Show backup file size
FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "  File size: $FILE_SIZE"

# Clean up old backups (keep last 30 days)
find "$BACKUP_DIR" -name "*.sql" -type f -mtime +30 -delete

echo "Done!"
