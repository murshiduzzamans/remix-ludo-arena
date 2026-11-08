# Run all D1 migrations for staging environment
# PowerShell version for Windows

$ErrorActionPreference = "Stop"

Write-Host "🚀 Running D1 migrations for STAGING environment..." -ForegroundColor Cyan
Write-Host ""

$DB_NAME = "ludo-arena-staging-db"
$MIGRATIONS_DIR = "migrations"

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

# Run each migration in order
foreach ($file in $migrationFiles) {
    Write-Host "⚙️  Applying: $($file.Name)" -ForegroundColor Yellow

    try {
        npx wrangler d1 execute $DB_NAME --env staging --file="$($file.FullName)"
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
npx wrangler d1 execute $DB_NAME --env staging --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

Write-Host ""
Write-Host "✨ Database ready for use!" -ForegroundColor Green
