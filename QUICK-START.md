# Quick Start - 5 Minute Setup

If you want to get started quickly and enable accounts later, follow this minimal path:

---

## Fastest Path to Running Locally (2 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Servers

**Terminal 1** - Start Vite (frontend):
```bash
npm run dev
```

**Terminal 2** - Start Cloudflare Worker (backend):
```bash
npm run dev:worker
```

### 3. Open App

Visit: http://localhost:3000

**That's it!** You now have:
- ✅ Solo vs AI bots
- ✅ Pass & play local multiplayer
- ✅ Team 2v2 mode
- ✅ Full game engine with all rules
- ✅ PWA features (offline play)

**What's NOT enabled yet:**
- ❌ Online multiplayer rooms (requires Cloudflare deployment)
- ❌ User accounts & profiles (requires a configured OAuth provider or recovery code, plus D1 setup)
- ❌ Leaderboard (requires accounts)
- ❌ Cloud game saves (requires accounts)

---

## Deploy Multiplayer Rooms Only (10 minutes)

Want online multiplayer but skip accounts for now?

### 1. Sign in to Cloudflare
```bash
npx wrangler login
```

### 2. Deploy
```bash
npm run deploy:worker
```

### 3. Play Online
Visit the deployed URL and create rooms!

**You now have:**
- ✅ Everything from local dev
- ✅ Online private rooms with friends
- ✅ Room codes and invite links
- ✅ Synchronized multiplayer
- ✅ Optional voice chat (if configured)

**Still not enabled:**
- ❌ User accounts (guests only)
- ❌ Leaderboard (no persistent stats)

---

## Full Setup with Accounts (45 minutes)

Want the complete experience with user accounts, profiles, stats, and leaderboard?

👉 **Follow the complete [MANUAL-SETUP-GUIDE.md](./MANUAL-SETUP-GUIDE.md)**

This includes:
- GitHub OAuth setup (or optional Google OAuth)
- Cloudflare D1 databases (15 min)
- Secret configuration (10 min)
- Database migrations (5 min)
- Deployment & testing (5 min)

GitHub OAuth and sync-code recovery are supported without Google Cloud billing.
Accounts will not appear until D1 databases, migrations, and secrets are configured.

---

## What You Get at Each Stage

### Stage 1: Local Dev Only
```
✓ Solo vs bots
✓ Pass & play multiplayer
✓ Team modes
✓ Full game rules
✓ Offline PWA
```

### Stage 2: + Multiplayer Deployed
```
✓ Everything above
✓ Online private rooms
✓ Guest players (temporary)
✓ WebSocket sync
✓ Optional voice chat
```

### Stage 3: + Accounts Enabled
```
✓ Everything above
✓ GitHub sign-in (or optional Google sign-in)
✓ Sync-code account recovery
✓ Persistent server account and profile identity
✓ Account restoration across devices
```

Completed game results are not yet connected to the account statistics/leaderboard
writer, so do not expect played games to appear in cloud stats yet.

---

## Choose Your Path

**Just want to try the game?**
→ Local dev (2 minutes)

**Want to play with friends online?**
→ Deploy multiplayer (10 minutes)

**Want the full experience with accounts?**
→ Full setup (45 minutes) - See [MANUAL-SETUP-GUIDE.md](./MANUAL-SETUP-GUIDE.md)

---

## Quick Commands Reference

```bash
# Development
npm run dev              # Start frontend (port 3000)
npm run dev:worker       # Start backend (port 8787)

# Testing
npm test                 # Run all tests
npm run lint             # TypeScript type checking

# Building
npm run build            # Production build

# Deployment
npm run deploy:worker    # Deploy default (no accounts)
npm run deploy:staging   # Deploy to staging
npm run deploy:production # Deploy to production

# Database (after setup)
npm run db:migrate:staging     # Run staging migrations
npm run db:migrate:production  # Run production migrations
npm run db:backup:staging      # Backup staging database
npm run db:backup:production   # Backup production database
```

---

## Troubleshooting Local Dev

### Frontend won't start
```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Worker won't start
```bash
# Make sure port 8787 is free
npx wrangler dev --config wrangler.toml --port 8787
```

### Both running but "connection failed"
Check `.env.example`:
```
VITE_MULTIPLAYER_API_URL=http://localhost:8787
```

Create a `.env` file with this if you want to test multiplayer locally.

---

**Ready to go? Pick your path and start building! 🚀**
