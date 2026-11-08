# Run all D1 migrations for production environment
# PowerShell version for Windows

$ErrorActionPreference = "Stop"

Write-Host "🚀 Running D1 migrations for PRODUCTION environment..." -ForegroundColor Red
Write-Host ""

$DB_NAME = "ludo-arena-prod-db"
$MIGRATIONS_DIR = "migrations"

# Safety check for production
Write-Host "⚠️  WARNING: You are about to run migrations on PRODUCTION database!" -ForegroundColor Yellow
$confirm = Read-Host "Are you sure you want to continue? (yes/NO)"

if ($confirm -ne "yes") {
    Write-Host "❌ Migration cancelled" -ForegroundColor Yellow
    exit 0
}

Write-Host ""

# Check if migrations directory exists
if (-not (Test-Path $MIGRATIONS_DIR)) {
    Write-Host "❌ Error: migrations directory not found" -ForegroundColor Red
    exit 1
}

# Get migration files
$migrationFiles = Get-ChildItem -Path $MIGRATIONS_DIR -Filter "*.sql" | Sort-Object Name

if ($migrationFiles.Count -eq 0) {
    Write-Host "❌ Error: No migration files found in $MIGRATIONS_DIR" -ForegroundColor Red
    exit 1
}

Write-Host "📦 Found $($migrationFiles.Count) migration files" -ForegroundColor Yellow
Write-Host ""

# Backup first
Write-Host "📦 Creating backup before migration..." -ForegroundColor Cyan
$BACKUP_DIR = "backups"
if (-not (Test-Path $BACKUP_DIR)) {
    New-Item -ItemType Directory -Path $BACKUP_DIR | Out-Null
}
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$BACKUP_FILE = "$BACKUP_DIR/pre-migration-$TIMESTAMP.sql"

try {
    npx wrangler d1 export $DB_NAME --env production --output "$BACKUP_FILE"
    Write-Host "✅ Backup saved: $BACKUP_FILE" -ForegroundColor Green
}
catch {
    Write-Host "⚠️  Could not export pre-migration backup (database might be new)." -ForegroundColor Yellow
}
Write-Host ""

# Run each migration in order
foreach ($file in $migrationFiles) {
    Write-Host "⚙️  Applying: $($file.Name)" -ForegroundColor Yellow

    try {
        npx wrangler d1 execute $DB_NAME --env production --file="$($file.FullName)"
        Write-Host "✅ Success: $($file.Name)" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ Failed: $($file.Name)" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

Write-Host "🎉 All migrations completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Verifying database schema..." -ForegroundColor Cyan

# Verify tables were created
npx wrangler d1 execute $DB_NAME --env production --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

Write-Host ""
Write-Host "✨ Production database ready!" -ForegroundColor Green
