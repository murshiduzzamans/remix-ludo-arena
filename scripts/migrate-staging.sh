#!/usr/bin/env bash
# Run all D1 migrations for staging environment
# This script applies all database migrations in order

set -e

echo "🚀 Running D1 migrations for STAGING environment..."
echo ""

DB_NAME="ludo-arena-staging-db"
MIGRATIONS_DIR="migrations"

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

# Run each migration in order
for migration_file in "$MIGRATIONS_DIR"/*.sql; do
    filename=$(basename "$migration_file")
    echo "⚙️  Applying: $filename"

    if npx wrangler d1 execute "$DB_NAME" --env staging --remote --file="$migration_file"; then
        echo "✅ Success: $filename"
    else
        echo "❌ Failed: $filename"
        exit 1
    fi
    echo ""
done

echo "🎉 All migrations completed successfully!"
echo ""
echo "📊 Verifying database schema..."

# Verify tables were created
npx wrangler d1 execute "$DB_NAME" --env staging --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
