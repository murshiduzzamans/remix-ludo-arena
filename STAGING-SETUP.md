# Staging Environment Setup Guide

This guide completes the final stage of the Ludo Arena deployment infrastructure by configuring a staging environment for testing before production deployment.

## Overview

The staging environment provides:
- Isolated testing environment separate from production
- Complete D1 database with migrations
- Auth endpoints (Google OAuth + sessions)
- Account management (profile, stats, leaderboard)
- Room integration with Durable Objects
- Progress recording system
- Voice chat capabilities (optional)

## Prerequisites

1. **Cloudflare Account**: Sign in with `npx wrangler login`
2. **Google OAuth Credentials**: Obtain from Google Cloud Console
3. **RealtimeKit Setup** (optional): For voice chat feature

## Stage 1: Create Staging Database

### 1.1 Create the D1 Database

```bash
# Create staging database
npx wrangler d1 create ludo-arena-staging-db --env staging
```

**Important**: Copy the `database_id` from the output.

### 1.2 Update wrangler.toml

Uncomment and fill in the staging database configuration in `wrangler.toml`:

```toml
[[env.staging.d1_databases]]
binding = "DB"
database_name = "ludo-arena-staging-db"
database_id = "YOUR_STAGING_DATABASE_ID"  # Replace with actual ID from step 1.1
```

### 1.3 Run Migrations

Execute all 8 migration files to set up the database schema:

```bash
# Run all migrations for staging
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=./migrations/0001_create_users_table.sql
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=./migrations/0002_create_sessions_table.sql
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=./migrations/0003_create_player_stats_table.sql
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=./migrations/0004_create_matches_table.sql
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=./migrations/0005_create_match_players_table.sql
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=./migrations/0006_add_github_and_sync_code.sql
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=./migrations/0007_add_profile_avatar.sql
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=./migrations/0008_add_match_progress_tracking.sql
```

Or use the migration script:

```bash
./scripts/migrate-staging.sh
```

### 1.4 Verify Database

```bash
# List tables in staging database
npx wrangler d1 execute ludo-arena-staging-db --env staging --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Expected output should show: `users`, `sessions`, `player_stats`, `matches`, `match_players`

## Stage 2: Configure Secrets

### 2.1 Google OAuth Credentials

Set up staging-specific OAuth credentials:

```bash
# Set Google OAuth credentials for staging
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
```

**Note**: Use separate OAuth credentials for staging (create a new OAuth app in Google Cloud Console with staging callback URL).

### 2.2 Session Secret

Generate and set a secure session secret:

```bash
# Generate a secure random string (32 bytes hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set the session secret
npx wrangler secret put SESSION_SECRET --env staging
```

### 2.3 Voice Chat Secrets (Optional)

If enabling voice chat in staging:

```bash
npx wrangler secret put CF_ACCOUNT_ID --env staging
npx wrangler secret put REALTIMEKIT_APP_ID --env staging
npx wrangler secret put REALTIMEKIT_API_TOKEN --env staging
npx wrangler secret put REALTIMEKIT_VOICE_PRESET --env staging
npx wrangler secret put VOICE_BUDGET_ADMIN_SECRET --env staging
```

## Stage 3: Configure Environment Variables

### 3.1 Update wrangler.toml

Add environment-specific variables to the staging environment:

```toml
[env.staging.vars]
ACCOUNTS_ENABLED = "true"
CHAT_ENABLED = "true"
VOICE_ENABLED = "false"  # Set to "true" if voice is configured
VOICE_MONTHLY_MINUTE_LIMIT = "2000"  # Lower limit for staging
ALLOWED_ORIGINS = "https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev"
```

### 3.2 OAuth Callback Configuration

Update your Google OAuth app settings:

- **Staging Authorized Redirect URI**: 
  `https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/auth/google/callback`

## Stage 4: Deploy to Staging

### 4.1 Build and Deploy

```bash
# Deploy to staging environment
npm run deploy:staging
```

Or manually:

```bash
npm run build
npx wrangler deploy --config wrangler.toml --env staging
```

### 4.2 Verify Deployment

After deployment, you should see:

```
✨ Successfully deployed to staging environment
🌐 Deployment URL: https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev
```

## Stage 5: Test Staging Environment

### 5.1 Health Check Endpoints

Test the core endpoints:

```bash
# Health check
curl https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/api/health

# Test guest authentication
curl -X POST https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/auth/guest \
  -H "Content-Type: application/json" \
  -d '{"displayName": "Test User"}'

# Test leaderboard (should return empty initially)
curl https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/auth/leaderboard
```

### 5.2 Google OAuth Flow

1. Visit: `https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/auth/google`
2. Complete Google sign-in
3. Verify redirect to app with session cookie

### 5.3 Room Creation Test

```bash
# Create a test room
curl -X POST https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/api/room/create \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{
    "mode": "classic_4p",
    "rules": {"maxSixes": 3, "exactFinish": true},
    "maxPlayers": 4
  }'
```

### 5.4 Database Verification

Check that data is being written:

```bash
# View users table
npx wrangler d1 execute ludo-arena-staging-db --env staging \
  --command="SELECT id, display_name, created_at FROM users LIMIT 5;"

# View sessions
npx wrangler d1 execute ludo-arena-staging-db --env staging \
  --command="SELECT user_id, created_at, expires_at FROM sessions LIMIT 5;"
```

## Stage 6: Monitoring & Maintenance

### 6.1 View Logs

```bash
# Stream staging logs
npx wrangler tail --env staging
```

### 6.2 Database Backups

Run regular backups:

```bash
# Manual backup
./scripts/backup-d1.sh staging

# Or using PowerShell on Windows
./scripts/backup-d1.ps1 staging
```

### 6.3 Monitor Voice Budget (if enabled)

```bash
# Check voice usage
curl -H "Authorization: Bearer YOUR_VOICE_BUDGET_ADMIN_SECRET" \
  https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/api/admin/voice-budget
```

## Stage 7: Smoke Testing Checklist

- [ ] Guest authentication works
- [ ] Google OAuth login works
- [ ] Profile creation and retrieval
- [ ] Room creation and joining
- [ ] WebSocket connection establishes
- [ ] Game state synchronization
- [ ] Chat messages (if enabled)
- [ ] Voice chat (if enabled)
- [ ] Leaderboard updates after games
- [ ] Stats tracking (wins/losses/games played)
- [ ] Session persistence across page reloads

## Troubleshooting

### Database Not Found

```bash
# List all D1 databases
npx wrangler d1 list

# Verify binding name matches wrangler.toml
```

### OAuth Redirect Mismatch

- Verify callback URL in Google Cloud Console matches deployment URL
- Check `ALLOWED_ORIGINS` includes your staging domain

### Secrets Not Loading

```bash
# List configured secrets
npx wrangler secret list --env staging

# Re-upload if missing
npx wrangler secret put SECRET_NAME --env staging
```

### Migration Errors

```bash
# Check migration status
npx wrangler d1 execute ludo-arena-staging-db --env staging \
  --command="SELECT name FROM sqlite_master WHERE type='table';"

# Reset database (WARNING: Deletes all data)
npx wrangler d1 execute ludo-arena-staging-db --env staging \
  --command="DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS player_stats; DROP TABLE IF EXISTS matches; DROP TABLE IF EXISTS match_players;"

# Re-run migrations
./scripts/migrate-staging.sh
```

## Differences from Production

| Feature | Staging | Production |
|---------|---------|------------|
| Database | `ludo-arena-staging-db` | `ludo-arena-prod-db` |
| Voice Minutes | 2,000/month | 8,000/month |
| Rate Limits | More lenient | Stricter |
| OAuth App | Separate credentials | Production credentials |
| Data Retention | Can be cleared regularly | Permanent |
| Monitoring | Optional | Required |

## Next Steps

Once staging is verified:

1. **Production Setup**: Follow similar steps for production environment
2. **CI/CD Integration**: Set up automated deployments
3. **Monitoring**: Configure alerts and dashboards
4. **Documentation**: Update team wiki with staging URLs and credentials

## Environment URLs

After setup, bookmark these URLs:

- **Staging App**: `https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev`
- **Staging OAuth**: `https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/auth/google`
- **Staging API**: `https://ludo-arena-multiplayer-staging.YOUR_SUBDOMAIN.workers.dev/api`

## Security Notes

1. **Separate OAuth Apps**: Always use different OAuth credentials for staging
2. **Unique Session Secrets**: Never reuse secrets between environments
3. **Access Control**: Limit staging access to development team
4. **Data Privacy**: Don't use real user data in staging
5. **Secret Rotation**: Rotate staging secrets regularly

## Completed Stages

✅ D1 database migrations (5 SQL files)
✅ Auth endpoints (Google OAuth + sessions)
✅ Account management (profile, stats, leaderboard)
✅ Room integration (identity in Durable Objects)
✅ Progress recording system
✅ Client UI components
✅ Tests for everything
✅ **Staging environment configuration** ← You are here

---

**Documentation Version**: 1.0  
**Last Updated**: 2026-11-08  
**Status**: Complete
