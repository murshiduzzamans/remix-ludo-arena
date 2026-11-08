#!/usr/bin/env pwsh
# Backup D1 database using wrangler d1 export
# Run this script regularly to backup your production database

param(
    [Parameter(Mandatory=$false)]
    [string]$Environment = "production",

    [Parameter(Mandatory=$false)]
    [string]$BackupDir = "backups"
)

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupFile = "$BackupDir/ludo-arena-$Environment-$timestamp.sql"

# Create backup directory if it doesn't exist
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

Write-Host "Backing up $Environment database..." -ForegroundColor Cyan

if ($Environment -eq "staging") {
    $dbName = "ludo-arena-staging-db"
    npx wrangler d1 export $dbName --env staging --output $backupFile
} elseif ($Environment -eq "production") {
    $dbName = "ludo-arena-prod-db"
    npx wrangler d1 export $dbName --env production --output $backupFile
} else {
    Write-Host "Error: Environment must be 'staging' or 'production'" -ForegroundColor Red
    exit 1
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Backup saved to: $backupFile" -ForegroundColor Green

    # Show backup file size
    $fileSize = (Get-Item $backupFile).Length / 1KB
    Write-Host "  File size: $([math]::Round($fileSize, 2)) KB" -ForegroundColor Gray

    # Clean up old backups (keep last 30 days)
    $oldBackups = Get-ChildItem $BackupDir -Filter "*.sql" | Where-Object {
        $_.LastWriteTime -lt (Get-Date).AddDays(-30)
    }

    if ($oldBackups) {
        Write-Host "`nCleaning up old backups..." -ForegroundColor Yellow
        $oldBackups | ForEach-Object {
            Write-Host "  Deleting: $($_.Name)" -ForegroundColor Gray
            Remove-Item $_.FullName
        }
    }
} else {
    Write-Host "✗ Backup failed" -ForegroundColor Red
    exit 1
}
