# Interactive script to set up all required secrets for staging environment
# PowerShell version for Windows

$ErrorActionPreference = "Stop"

Write-Host "🔐 Staging Environment Secrets Setup" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script will help you configure all required secrets for the staging environment."
Write-Host ""

# Function to prompt for secret
function Set-Secret {
    param(
        [string]$SecretName,
        [string]$Description,
        [string]$Example = ""
    )

    Write-Host ""
    Write-Host "📝 Setting: $SecretName" -ForegroundColor Yellow
    Write-Host "   Description: $Description"
    if ($Example) {
        Write-Host "   Example: $Example" -ForegroundColor Gray
    }
    Write-Host ""

    $secretValue = Read-Host "Enter value for $SecretName (or press Enter to skip)"

    if ($secretValue) {
        $secretValue | npx wrangler secret put $SecretName --env staging
        Write-Host "✅ $SecretName configured" -ForegroundColor Green
    }
    else {
        Write-Host "⏭️  Skipped $SecretName" -ForegroundColor Gray
    }
}

# Required secrets
Write-Host "Required Secrets:" -ForegroundColor Cyan
Write-Host "----------------" -ForegroundColor Cyan

Set-Secret -SecretName "GOOGLE_CLIENT_ID" `
    -Description "Google OAuth Client ID from Google Cloud Console" `
    -Example "123456789-abc.apps.googleusercontent.com"

Set-Secret -SecretName "GOOGLE_CLIENT_SECRET" `
    -Description "Google OAuth Client Secret from Google Cloud Console" `
    -Example "GOCSPX-xxxxxxxxxxxxxxxx"

# Generate session secret suggestion
try {
    $sessionSecretSuggestion = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

    Write-Host ""
    Write-Host "📝 Setting: SESSION_SECRET" -ForegroundColor Yellow
    Write-Host "   Description: Secret key for session encryption (auto-generated)"
    Write-Host "   Suggested value: $sessionSecretSuggestion" -ForegroundColor Gray
    Write-Host ""
    $useSuggested = Read-Host "Use suggested value? (Y/n)"

    if ($useSuggested -eq 'n' -or $useSuggested -eq 'N') {
        Set-Secret -SecretName "SESSION_SECRET" `
            -Description "Custom session secret (32+ characters)" `
            -Example ""
    }
    else {
        $sessionSecretSuggestion | npx wrangler secret put "SESSION_SECRET" --env staging
        Write-Host "✅ SESSION_SECRET configured with generated value" -ForegroundColor Green
    }
}
catch {
    Set-Secret -SecretName "SESSION_SECRET" `
        -Description "Secret key for session encryption (32+ characters hex)" `
        -Example ""
}

Write-Host ""
Write-Host "Optional Voice Chat Secrets:" -ForegroundColor Cyan
Write-Host "---------------------------" -ForegroundColor Cyan
Write-Host "Skip these if you're not enabling voice chat in staging"
Write-Host ""

$configureVoice = Read-Host "Configure voice chat secrets? (y/N)"

if ($configureVoice -eq 'y' -or $configureVoice -eq 'Y') {
    Set-Secret -SecretName "CF_ACCOUNT_ID" `
        -Description "Cloudflare Account ID" `
        -Example "your_cloudflare_account_id"

    Set-Secret -SecretName "REALTIMEKIT_APP_ID" `
        -Description "RealtimeKit App ID" `
        -Example "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

    Set-Secret -SecretName "REALTIMEKIT_API_TOKEN" `
        -Description "RealtimeKit API Token" `
        -Example "cfut_xxxxxxxxxx"

    Set-Secret -SecretName "REALTIMEKIT_VOICE_PRESET" `
        -Description "RealtimeKit Voice Preset Name" `
        -Example "Voice Chat"

    # Generate voice budget admin secret
    try {
        $voiceSecretSuggestion = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

        Write-Host ""
        Write-Host "📝 Setting: VOICE_BUDGET_ADMIN_SECRET" -ForegroundColor Yellow
        Write-Host "   Description: Admin secret for voice budget API (auto-generated)"
        Write-Host "   Suggested value: $voiceSecretSuggestion" -ForegroundColor Gray
        Write-Host ""
        $useSuggestedVoice = Read-Host "Use suggested value? (Y/n)"

        if ($useSuggestedVoice -eq 'n' -or $useSuggestedVoice -eq 'N') {
            Set-Secret -SecretName "VOICE_BUDGET_ADMIN_SECRET" `
                -Description "Custom admin secret" `
                -Example ""
        }
        else {
            $voiceSecretSuggestion | npx wrangler secret put "VOICE_BUDGET_ADMIN_SECRET" --env staging
            Write-Host "✅ VOICE_BUDGET_ADMIN_SECRET configured" -ForegroundColor Green
        }
    }
    catch {
        Set-Secret -SecretName "VOICE_BUDGET_ADMIN_SECRET" `
            -Description "Admin secret for voice budget monitoring" `
            -Example ""
    }
}

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "✨ Secrets configuration complete!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Update wrangler.toml with your staging database ID"
Write-Host "2. Run migrations: .\scripts\migrate-staging.ps1"
Write-Host "3. Deploy to staging: npm run deploy:staging"
Write-Host ""
Write-Host "To view configured secrets:"
Write-Host "  npx wrangler secret list --env staging"
