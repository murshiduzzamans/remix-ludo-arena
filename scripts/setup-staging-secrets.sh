#!/usr/bin/env bash
# Interactive script to set up all required secrets for staging environment

set -e

echo "🔐 Staging Environment Secrets Setup"
echo "===================================="
echo ""
echo "This script will help you configure all required secrets for the staging environment."
echo ""

# Function to prompt for secret
set_secret() {
    local secret_name=$1
    local description=$2
    local example=$3

    echo ""
    echo "📝 Setting: $secret_name"
    echo "   Description: $description"
    if [ -n "$example" ]; then
        echo "   Example: $example"
    fi
    echo ""

    read -p "Enter value for $secret_name (or press Enter to skip): " secret_value

    if [ -n "$secret_value" ]; then
        echo "$secret_value" | npx wrangler secret put "$secret_name" --env staging
        echo "✅ $secret_name configured"
    else
        echo "⏭️  Skipped $secret_name"
    fi
}

# Required secrets
echo "Required Secrets:"
echo "----------------"

set_secret "GOOGLE_CLIENT_ID" \
    "Google OAuth Client ID from Google Cloud Console" \
    "123456789-abc.apps.googleusercontent.com"

set_secret "GOOGLE_CLIENT_SECRET" \
    "Google OAuth Client Secret from Google Cloud Console" \
    "GOCSPX-xxxxxxxxxxxxxxxx"

# Generate session secret suggestion
SESSION_SECRET_SUGGESTION=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || echo "")

if [ -n "$SESSION_SECRET_SUGGESTION" ]; then
    echo ""
    echo "📝 Setting: SESSION_SECRET"
    echo "   Description: Secret key for session encryption (auto-generated)"
    echo "   Suggested value: $SESSION_SECRET_SUGGESTION"
    echo ""
    read -p "Use suggested value? (Y/n): " use_suggested

    if [[ "$use_suggested" =~ ^[Nn]$ ]]; then
        set_secret "SESSION_SECRET" "Custom session secret (32+ characters)" ""
    else
        echo "$SESSION_SECRET_SUGGESTION" | npx wrangler secret put "SESSION_SECRET" --env staging
        echo "✅ SESSION_SECRET configured with generated value"
    fi
else
    set_secret "SESSION_SECRET" "Secret key for session encryption (32+ characters hex)" ""
fi

echo ""
echo "Optional Voice Chat Secrets:"
echo "---------------------------"
echo "Skip these if you're not enabling voice chat in staging"
echo ""

read -p "Configure voice chat secrets? (y/N): " configure_voice

if [[ "$configure_voice" =~ ^[Yy]$ ]]; then
    set_secret "CF_ACCOUNT_ID" \
        "Cloudflare Account ID" \
        "your_cloudflare_account_id"

    set_secret "REALTIMEKIT_APP_ID" \
        "RealtimeKit App ID" \
        "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

    set_secret "REALTIMEKIT_API_TOKEN" \
        "RealtimeKit API Token" \
        "cfut_xxxxxxxxxx"

    set_secret "REALTIMEKIT_VOICE_PRESET" \
        "RealtimeKit Voice Preset Name" \
        "Voice Chat"

    # Generate voice budget admin secret
    VOICE_SECRET_SUGGESTION=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || echo "")

    if [ -n "$VOICE_SECRET_SUGGESTION" ]; then
        echo ""
        echo "📝 Setting: VOICE_BUDGET_ADMIN_SECRET"
        echo "   Description: Admin secret for voice budget API (auto-generated)"
        echo "   Suggested value: $VOICE_SECRET_SUGGESTION"
        echo ""
        read -p "Use suggested value? (Y/n): " use_suggested_voice

        if [[ "$use_suggested_voice" =~ ^[Nn]$ ]]; then
            set_secret "VOICE_BUDGET_ADMIN_SECRET" "Custom admin secret" ""
        else
            echo "$VOICE_SECRET_SUGGESTION" | npx wrangler secret put "VOICE_BUDGET_ADMIN_SECRET" --env staging
            echo "✅ VOICE_BUDGET_ADMIN_SECRET configured"
        fi
    else
        set_secret "VOICE_BUDGET_ADMIN_SECRET" "Admin secret for voice budget monitoring" ""
    fi
fi

echo ""
echo "=================================="
echo "✨ Secrets configuration complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "1. Update wrangler.toml with your staging database ID"
echo "2. Run migrations: ./scripts/migrate-staging.sh"
echo "3. Deploy to staging: npm run deploy:staging"
echo ""
echo "To view configured secrets:"
echo "  npx wrangler secret list --env staging"
