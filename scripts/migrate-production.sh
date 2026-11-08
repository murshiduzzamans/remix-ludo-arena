#!/usr/bin/env bash
# Run all D1 migrations for production environment
# This script applies all database migrations in order

set -e

echo "🚀 Running D1 migrations for PRODUCTION environment..."
echo ""

DB_NAME="ludo-arena-prod-db"
MIGRATIONS_DIR="migrations"

# Safety check for production
echo "⚠️  WARNING: You are about to run migrations on PRODUCTION database!"
echo ""
read -p "Are you sure you want to continue? (yes/NO): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Migration cancelled"
    exit 0
fi

echo ""

# Check if migrations directory exists
if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "❌ Error: migrations directory not found"
    exit 1
fi

# Count migration files
MIGRATION_COUNT=$(ls -1 "$MIGRATIONS_DIR"/*.sql 2>/dev/null | wc -l)
if [ "$MIGRATION_COUNT" -eq 0 ]; then
    echo "❌ Error: No migration files found in $MIGRATIONS_DIR"
    exit 1
fi

echo "📦 Found $MIGRATION_COUNT migration files"
echo ""

# Backup first
echo "📦 Creating backup before migration..."
BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/pre-migration-$TIMESTAMP.sql"

npx wrangler d1 export "$DB_NAME" --env production --output "$BACKUP_FILE"
echo "✅ Backup saved: $BACKUP_FILE"
echo ""

# Run each migration in order
for migration_file in "$MIGRATIONS_DIR"/*.sql; do
    filename=$(basename "$migration_file")
    echo "⚙️  Applying: $filename"

    if npx wrangler d1 execute "$DB_NAME" --env production --file="$migration_file"; then
        echo "✅ Success: $filename"
    else
        echo "❌ Failed: $filename"
        echo ""
        echo "💡 Backup available at: $BACKUP_FILE"
        exit 1
    fi
    echo ""
done

echo "🎉 All migrations completed successfully!"
echo ""
echo "📊 Verifying database schema..."

# Verify tables were created
npx wrangler d1 execute "$DB_NAME" --env production --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

echo ""
echo "✨ Production database ready!"
