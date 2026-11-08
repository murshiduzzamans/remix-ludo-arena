# Comprehensive deployment checklist and quick reference

## Quick Deploy Commands

### Staging Deployment
```bash
# Full staging deployment
npm run deploy:staging

# Or step by step:
npm run build
npx wrangler deploy --config wrangler.toml --env staging
```

### Production Deployment
```bash
# Full production deployment
npm run deploy:production

# Or step by step:
npm run build
npx wrangler deploy --config wrangler.toml --env production
```

## Pre-Deployment Checklist

### First-Time Setup (Staging)

- [ ] Create D1 database: `npx wrangler d1 create ludo-arena-staging-db --env staging`
- [ ] Update `wrangler.toml` with staging database ID
- [ ] Configure secrets: `./scripts/setup-staging-secrets.sh` (or `.ps1` on Windows)
- [ ] Run migrations: `npm run db:migrate:staging`
- [ ] Deploy: `npm run deploy:staging`
- [ ] Verify deployment and test all endpoints
- [ ] Configure Google OAuth callback URL

### First-Time Setup (Production)

- [ ] Create D1 database: `npx wrangler d1 create ludo-arena-prod-db --env production`
- [ ] Update `wrangler.toml` with production database ID
- [ ] Configure secrets: `./scripts/setup-production-secrets.sh`
- [ ] Run migrations: `npm run db:migrate:production`
- [ ] Configure Google OAuth production credentials
- [ ] Set up monitoring and alerts
- [ ] Deploy: `npm run deploy:production`
- [ ] Run smoke tests on production
- [ ] Verify all critical paths

### Pre-Deployment (Every Deploy)

- [ ] Run all tests: `npm test`
- [ ] Run type checking: `npm run lint`
- [ ] Test locally: `npm run dev` + `npm run dev:worker`
- [ ] Review recent commits
- [ ] Check for sensitive data in code
- [ ] Verify environment variables are set
- [ ] Create database backup: `npm run db:backup:staging` or `npm run db:backup:production`

### Post-Deployment Verification

- [ ] Health check endpoint responds: `/api/health`
- [ ] Guest authentication works: `/auth/guest`
- [ ] Google OAuth works: `/auth/google`
- [ ] Room creation works
- [ ] WebSocket connections establish
- [ ] Game state synchronization works
- [ ] Check error logs: `npx wrangler tail --env [staging|production]`
- [ ] Verify database writes are happening
- [ ] Test voice chat (if enabled)
- [ ] Monitor for errors in first 10 minutes

## Environment Comparison

| Feature | Local Dev | Staging | Production |
|---------|-----------|---------|------------|
| Database | Dev (local) | `ludo-arena-staging-db` | `ludo-arena-prod-db` |
| URL | `localhost:8787` | `*-staging.workers.dev` | `*-production.workers.dev` |
| OAuth | Dev credentials | Staging credentials | Production credentials |
| Voice Minutes | Unlimited | 2,000/month | 8,000/month |
| Data | Ephemeral | Test data | Real users |
| Logs | Console | `wrangler tail` | `wrangler tail` + monitoring |

## Secret Management

### Required Secrets (All Environments)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET` (32+ char hex)

### Optional Secrets (Voice Chat)
- `CF_ACCOUNT_ID`
- `REALTIMEKIT_APP_ID`
- `REALTIMEKIT_API_TOKEN`
- `REALTIMEKIT_VOICE_PRESET`
- `VOICE_BUDGET_ADMIN_SECRET`

### Manage Secrets
```bash
# List configured secrets
npx wrangler secret list --env staging

# Add/update a secret
npx wrangler secret put SECRET_NAME --env staging

# Delete a secret
npx wrangler secret delete SECRET_NAME --env staging
```

## Database Operations

### Migrations
```bash
# Run staging migrations
npm run db:migrate:staging

# Run production migrations
npm run db:migrate:production
```

### Backups
```bash
# Backup staging database
npm run db:backup:staging

# Backup production database
npm run db:backup:production

# Manual backup
npx wrangler d1 export ludo-arena-staging-db --env staging --output backups/manual-backup.sql
```

### Query Database
```bash
# Execute SQL command
npx wrangler d1 execute ludo-arena-staging-db --env staging --command="SELECT * FROM users LIMIT 5;"

# Execute SQL file
npx wrangler d1 execute ludo-arena-staging-db --env staging --file=query.sql
```

## Monitoring

### View Logs
```bash
# Stream staging logs
npx wrangler tail --env staging

# Stream production logs
npx wrangler tail --env production

# Filter logs
npx wrangler tail --env production --format pretty
```

### Check Deployment Status
```bash
# List deployments
npx wrangler deployments list --env production

# View specific deployment
npx wrangler deployment view DEPLOYMENT_ID
```

### Voice Budget Monitoring (if enabled)
```bash
# Check current usage
curl -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  https://YOUR_WORKER_URL/api/admin/voice-budget
```

## Rollback Procedure

### If deployment fails:
1. Check logs: `npx wrangler tail --env [staging|production]`
2. Identify the issue
3. Fix code
4. Redeploy: `npm run deploy:[staging|production]`

### If database migration fails:
1. Restore from backup:
   ```bash
   npx wrangler d1 execute DB_NAME --env ENV --file=backups/backup.sql
   ```
2. Fix migration SQL
3. Re-run migrations

### Emergency rollback:
1. Restore database backup
2. Redeploy previous working version from git:
   ```bash
   git checkout PREVIOUS_COMMIT
   npm run deploy:production
   git checkout main
   ```

## Troubleshooting

### Deployment fails with "binding not found"
- Verify `wrangler.toml` has all required bindings
- Check D1 database ID is correct
- Ensure Durable Object migrations are listed

### OAuth redirect mismatch
- Update callback URL in Google Cloud Console
- Verify `ALLOWED_ORIGINS` matches deployment URL

### Database not found
- Run: `npx wrangler d1 list` to see all databases
- Verify database name matches `wrangler.toml`
- Check environment (staging vs production)

### Secrets not loading
- List secrets: `npx wrangler secret list --env ENV`
- Re-upload missing secrets
- Check secret names match code exactly (case-sensitive)

### WebSocket connection fails
- Check `ALLOWED_ORIGINS` includes client URL
- Verify Durable Object binding is correct
- Test with: `wscat -c wss://YOUR_WORKER_URL/api/room/ws/ROOM_CODE`

## Performance Tips

1. **Enable caching**: Static assets are cached via `[assets]` binding
2. **Use CDN**: Cloudflare automatically CDNs your worker
3. **Rate limiting**: Configured in `wrangler.toml` for room creation/joining
4. **Database indexes**: Already configured in migration files
5. **Connection pooling**: D1 handles this automatically

## Security Checklist

- [ ] Never commit `.dev.vars` or secrets
- [ ] Use different OAuth apps for staging/production
- [ ] Rotate secrets regularly
- [ ] Enable rate limiting in production
- [ ] Monitor for suspicious activity
- [ ] Keep dependencies updated
- [ ] Use HTTPS only (Cloudflare enforces this)

## Support

If you encounter issues:
1. Check logs: `npx wrangler tail --env ENV`
2. Review this checklist
3. Consult `STAGING-SETUP.md` for detailed setup
4. Check Cloudflare dashboard for service status
5. Review Cloudflare Workers documentation

## Quick Links

- **Cloudflare Dashboard**: https://dash.cloudflare.com
- **Workers Logs**: Dashboard → Workers & Pages → Your Worker → Logs
- **D1 Database**: Dashboard → Workers & Pages → D1
- **Google Cloud Console**: https://console.cloud.google.com

---

**Last Updated**: 2026-11-08  
**Version**: 1.0
