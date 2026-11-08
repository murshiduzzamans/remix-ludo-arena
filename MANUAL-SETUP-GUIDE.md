# Manual Setup Guide - Ludo Arena Accounts & Authentication

This guide walks you through the manual steps required to enable accounts, authentication, and complete deployment of Ludo Arena.

---

## Overview

You'll set up:
1. **GitHub OAuth or Google OAuth** - For user login (GitHub does not require Google Cloud billing)
2. **Cloudflare D1 Databases** - For storing user data (staging + production)
3. **Cloudflare Secrets** - Secure credentials
4. **Database Migrations** - Create tables
5. **Deployment** - Push to Cloudflare Workers
6. **Testing & Activation** - Verify and enable accounts

GitHub sign-in and sync-code account recovery are both supported. Recovery codes can
restore the same server account on another device; keep the code private and store it
somewhere safe. Account features remain unavailable until D1, migrations, and secrets
are configured.

**Estimated Time**: 30-45 minutes

---

## Prerequisites

- [ ] Cloudflare account (free tier works)
- [ ] Google Cloud account (free tier works)
- [ ] Node.js and npm installed
- [ ] This project's code ready

---

## Step 1: Google Cloud Setup (10 minutes)

### 1.1 Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click "Select a project" → "New Project"
3. Name it: `Ludo Arena` or similar
4. Click "Create"

### 1.2 Configure OAuth Consent Screen

1. In the left menu, go to **APIs & Services** → **OAuth consent screen**
2. Choose **External** (allows anyone to sign in)
3. Click "Create"

**Fill in the form:**
- **App name**: `Ludo Arena`
- **User support email**: Your email
- **Developer contact email**: Your email
- **App logo** (optional): Upload your game logo
- Click "Save and Continue"

**Scopes:**
- Click "Add or Remove Scopes"
- Add these three scopes:
  - `openid`
  - `profile`
  - `email`
- Click "Update" → "Save and Continue"

**Test users** (skip for now):
- Click "Save and Continue"

**Summary:**
- Review and click "Back to Dashboard"

### 1.3 Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click "Create Credentials" → "OAuth client ID"
3. Choose **Web application**
4. Name it: `Ludo Arena Web Client`

**Authorized JavaScript origins:**
```
http://localhost:3000
http://localhost:8787
```

**Authorized redirect URIs** (we'll add production URLs later):
```
http://localhost:8787/api/auth/google/callback
```

5. Click "Create"
6. **IMPORTANT**: Copy the **Client ID** and **Client Secret**
   - Save them in a secure note or password manager
   - You'll need these in Step 3

### 1.4 Alternative: Create a GitHub OAuth App

Use this option if Google Cloud setup or billing is unavailable.

1. In GitHub, open **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. Set the application URL to your game URL. For local testing, use `http://localhost:3000`.
3. Set the authorization callback URL to the Worker URL followed by:
   ```
   /api/auth/github/callback
   ```
4. Create the app, then generate a client secret. Save the **Client ID** and **Client Secret** for Step 3.

---

## Step 2: Cloudflare Setup (15 minutes)

### 2.1 Sign in to Cloudflare

```bash
npx wrangler login
```

This opens a browser window to authorize. Click "Allow" to connect your terminal to Cloudflare.

### 2.2 Create Staging Database

```bash
npx wrangler d1 create ludo-arena-staging-db
```

**Copy the output** - you'll see something like:
```
✅ Successfully created DB 'ludo-arena-staging-db' (abc123-def456-ghi789)

[[d1_databases]]
binding = "DB"
database_name = "ludo-arena-staging-db"
database_id = "abc123-def456-ghi789"
```

**Save this database_id**: `abc123-def456-ghi789`

### 2.3 Create Production Database

```bash
npx wrangler d1 create ludo-arena-prod-db
```

**Copy the output** - save the production database_id too.

### 2.4 Update wrangler.toml

Open `wrangler.toml` and find these sections (around lines 71-92):

**For staging** (line 71-74):
```toml
[[env.staging.d1_databases]]
binding = "DB"
database_name = "ludo-arena-staging-db"
database_id = "YOUR_STAGING_DATABASE_ID"  # ← Replace with actual ID from step 2.2
```

**For production** (line 88-92):
```toml
[[env.production.d1_databases]]
binding = "DB"
database_name = "ludo-arena-prod-db"
database_id = "YOUR_PROD_DATABASE_ID"  # ← Replace with actual ID from step 2.3
```

**Save the file.**

---

## Step 3: Configure Secrets (10 minutes)

### ⚠️ Windows Users - Important!

**DO NOT use the command-line scripts** (`setup-staging-secrets.sh` or `.ps1`) on Windows! They have newline issues that break secrets.

**Instead, use the Cloudflare Dashboard method below** (recommended for everyone).

### 3.1 Generate Session Secrets

Open Node.js and generate two random secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run this **twice** - save both values:
- First one: **Staging Session Secret**
- Second one: **Production Session Secret**

Example output: `a7f3e8c2b9d4f1a6e5c8b3d7f9a2e1c4...`

### 3.2 Upload Secrets via Cloudflare Dashboard

**For Staging:**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Workers & Pages**
3. Find your worker (will appear after first deploy, or we'll add secrets via CLI for now)

**OR use CLI (works on all systems):**

```bash
# Staging secrets
echo "PASTE_YOUR_STAGING_SESSION_SECRET_HERE" | npx wrangler secret put SESSION_SECRET --env staging
```

For GitHub sign-in, also add the GitHub OAuth app credentials:
```bash
echo "PASTE_YOUR_GITHUB_CLIENT_ID_HERE" | npx wrangler secret put GITHUB_CLIENT_ID --env staging
echo "PASTE_YOUR_GITHUB_CLIENT_SECRET_HERE" | npx wrangler secret put GITHUB_CLIENT_SECRET --env staging
```

Google credentials are optional. If using Google instead, add `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` in the same way. Repeat the commands with `--env production`
for production secrets.

**For Production:**

```bash
# Production secrets
echo "PASTE_YOUR_PRODUCTION_SESSION_SECRET_HERE" | npx wrangler secret put SESSION_SECRET --env production
```

**Replace the placeholders** with actual values:
- OAuth Client ID and Secret for each provider you intend to offer
- Session Secrets from Step 3.1

### 3.3 Verify Secrets Were Uploaded

```bash
# Check staging
npx wrangler secret list --env staging

# Check production
npx wrangler secret list --env production
```

You should see:
```
GITHUB_CLIENT_ID (if using GitHub) or GOOGLE_CLIENT_ID (if using Google)
GITHUB_CLIENT_SECRET (if using GitHub) or GOOGLE_CLIENT_SECRET (if using Google)
SESSION_SECRET
```

---

## Step 4: Run Database Migrations (5 minutes)

### 4.1 Migrate Staging Database

```bash
npm run db:migrate:staging
```

Expected output:
```
🚀 Running D1 migrations for STAGING environment...
📦 Found 6 migration files
⚙️  Applying: 0001_create_users_table.sql
✅ Success: 0001_create_users_table.sql
⚙️  Applying: 0002_create_sessions_table.sql
✅ Success: 0002_create_sessions_table.sql
...
⚙️  Applying: 0006_add_github_and_sync_code.sql
🎉 All migrations completed successfully!
```

### 4.2 Verify Staging Tables

```bash
npx wrangler d1 execute ludo-arena-staging-db --env staging --command="SELECT name FROM sqlite_master WHERE type='table';"
```

You should see:
```
users
sessions
player_stats
matches
match_players
```

The final migration adds the GitHub identity and unique sync-code columns to `users`.

### 4.3 Migrate Production Database

```bash
npm run db:migrate:production
```

When prompted:
```
⚠️  WARNING: You are about to run migrations on PRODUCTION database!

Are you sure you want to continue? (yes/NO):
```

Type `yes` and press Enter.

### 4.4 Verify Production Tables

```bash
npx wrangler d1 execute ludo-arena-prod-db --env production --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Should show the same 5 tables.

---

## Step 5: Deploy to Staging (5 minutes)

### 5.1 Build and Deploy

```bash
npm run deploy:staging
```

Expected output:
```
> vite build
✓ 1746 modules transformed.
✓ built in 421ms

> wrangler deploy --env staging
✨ Uploading...
✨ Deployment complete!
🌐 https://ludo-arena-multiplayer-staging.YOUR-SUBDOMAIN.workers.dev
```

**SAVE THIS URL** - you'll need it next!

### 5.2 Update OAuth Provider with Staging URL

For Google, go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials**. For GitHub, go to **Settings** → **Developer settings** → **OAuth Apps**.

Set the callback URL to `https://ludo-arena-multiplayer-staging.YOUR-SUBDOMAIN.workers.dev/api/auth/PROVIDER/callback`, replacing `PROVIDER` with `github` or `google` and `YOUR-SUBDOMAIN` with your Cloudflare Workers subdomain.

---

## Step 6: Test Staging (10 minutes)

### 6.1 Health Check

Open your browser and visit:
```
https://ludo-arena-multiplayer-staging.YOUR-SUBDOMAIN.workers.dev
```

You should see the Ludo Arena game!

### 6.2 Test Guest Authentication

Open browser console (F12) and run:
```javascript
fetch('https://ludo-arena-multiplayer-staging.YOUR-SUBDOMAIN.workers.dev/api/auth/guest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ displayName: 'Test User' })
}).then(r => r.json()).then(console.log)
```

Expected response:
```json
{
  "user": {
    "id": "...",
    "displayName": "Test User",
    "isGuest": true,
    ...
  }
}
```

### 6.3 Test OAuth sign-in

Click the configured sign-in button in the app, or visit:
```
https://ludo-arena-multiplayer-staging.YOUR-SUBDOMAIN.workers.dev/api/auth/PROVIDER/start
```
Replace `PROVIDER` with `github` or `google`. Complete sign-in to return to the app. A sync code can also restore the account on another device.

### 6.4 Test Leaderboard

Visit:
```
https://ludo-arena-multiplayer-staging.YOUR-SUBDOMAIN.workers.dev/api/leaderboard
```

Should return empty array (no games played yet):
```json
[]
```

### 6.5 Verify Database

```bash
npx wrangler d1 execute ludo-arena-staging-db --env staging --command="SELECT id, display_name, is_guest FROM users LIMIT 5;"
```

You should see your test user(s).

---

## Step 7: Deploy to Production (5 minutes)

### 7.1 Build and Deploy Production

```bash
npm run deploy:production
```

Expected output:
```
✨ Deployment complete!
🌐 https://ludo-arena-multiplayer-production.YOUR-SUBDOMAIN.workers.dev
```

**SAVE THIS URL** - this is your live production URL!

### 7.2 Update OAuth Provider with Production URL

Update your configured provider (Google or GitHub) with this production callback:
`https://ludo-arena-multiplayer-production.YOUR-SUBDOMAIN.workers.dev/api/auth/PROVIDER/callback`

**Optional**: Add your custom domain if you have one:
```
https://yourdomain.com/api/auth/PROVIDER/callback
```

Replace `PROVIDER` with `github` or `google`.

### 7.3 Test Production

Visit your production URL and test:
- [ ] Game loads
- [ ] Configured OAuth sign-in works
- [ ] Guest mode works
- [ ] Room creation works

---

## Step 8: Enable Accounts Feature (FINAL STEP)

Enable accounts only after D1 bindings, migrations, and `SESSION_SECRET` are configured. OAuth sign-in also requires credentials for the selected provider.

### 8.1 Enable in Staging

Update `wrangler.toml` around line 60 (staging environment):

```toml
[env.staging.vars]
ACCOUNTS_ENABLED = "true"
CHAT_ENABLED = "true"
VOICE_ENABLED = "false"  # Set to "true" if you configured voice
```

Redeploy staging:
```bash
npm run deploy:staging
```

### 8.2 Enable in Production

Update `wrangler.toml` around line 80 (production environment):

```toml
[env.production.vars]
ACCOUNTS_ENABLED = "true"
CHAT_ENABLED = "true"
VOICE_ENABLED = "false"
```

Redeploy production:
```bash
npm run deploy:production
```

### 8.3 Verify Account Features

Visit your production URL. You should now see:
- **Account indicator** in top-right corner
- **Account profile** and sign-in controls
- **Sign in with GitHub/Google** and sync-code recovery controls

The database has statistics and leaderboard tables, but completed online games are not
currently connected to the stats writer. Game results will not yet appear in cloud
statistics or the leaderboard.

---

## Optional: Custom Domain Setup

If you want to use your own domain (e.g., `ludoarena.com`):

1. In Cloudflare Dashboard → **Workers & Pages** → Your Worker
2. Click **Settings** → **Domains & Routes**
3. Click "Add Custom Domain"
4. Enter your domain
5. Follow DNS setup instructions
6. Add your custom domain callback URL to the configured OAuth provider

---

## Optional: Voice Chat Setup

If you want to enable voice chat (optional, costs money):

See `VOICE-SETUP-AND-TEST-PLAN.md` for complete instructions on:
- Setting up Cloudflare RealtimeKit
- Configuring voice secrets
- Setting monthly minute limits
- Testing voice functionality

---

## Troubleshooting

### "Database not found"

```bash
# List all databases
npx wrangler d1 list

# Make sure database_id in wrangler.toml matches exactly
```

### "Secrets not loading"

```bash
# Re-upload secrets
npx wrangler secret list --env staging
npx wrangler secret put SECRET_NAME --env staging
```

### "OAuth redirect mismatch"

- Check the provider callback URL matches exactly, including `/api/auth/{provider}/callback`
- Make sure no trailing slashes
- Protocol must be `https` (not `http`) for production

### "Session not persisting"

- Verify `SESSION_SECRET` is set correctly
- Check that secret is at least 32 characters
- Make sure no newline characters in secret (use dashboard method on Windows)

### "TypeError: Cannot read property 'prepare'"

- Database binding is missing in wrangler.toml
- Uncomment the `[[env.staging.d1_databases]]` section
- Make sure `database_id` is filled in

---

## Success Checklist

- [ ] GitHub or Google OAuth credentials created
- [ ] Staging D1 database created and migrated
- [ ] Production D1 database created and migrated
- [ ] Provider credentials and SESSION_SECRET uploaded
- [ ] Staging deployed and tested
- [ ] Production deployed and tested
- [ ] OAuth callback URL updated
- [ ] `ACCOUNTS_ENABLED=true` set in wrangler.toml
- [ ] Account features visible in production app

---

## Monitoring & Maintenance

### View Logs

```bash
# Stream staging logs
npx wrangler tail --env staging

# Stream production logs
npx wrangler tail --env production
```

### Backup Databases

```bash
# Backup staging
npm run db:backup:staging

# Backup production
npm run db:backup:production
```

Backups are saved in `backups/` directory.

### Check Voice Usage (if enabled)

```bash
curl -H "Authorization: Bearer YOUR_VOICE_BUDGET_ADMIN_SECRET" \
  https://YOUR-WORKER-URL/api/admin/voice-budget
```

---

## Next Steps

Once everything is working:

1. **Share your production URL** with friends to test multiplayer
2. **Set up custom domain** for a professional URL
3. **Monitor usage** in Cloudflare Dashboard
4. **Enable voice chat** if needed (optional)
5. **Add analytics** (optional - Google Analytics, Plausible, etc.)

---

## Support Resources

- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **Cloudflare D1 Docs**: https://developers.cloudflare.com/d1/
- **Google OAuth Guide**: https://developers.google.com/identity/protocols/oauth2
- **Your project docs**: Check `STAGING-SETUP.md` and `DEPLOYMENT-CHECKLIST.md`

---

**Congratulations! Your Ludo Arena is now live with full account features! 🎉**

Last Updated: 2026-11-08
