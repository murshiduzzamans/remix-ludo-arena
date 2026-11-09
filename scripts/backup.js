#!/usr/bin/env node
/**
 * Cross-platform D1 database backup runner
 * Usage: node scripts/backup.js [staging|production]
 */

import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const env = process.argv[2] || 'production';
if (env !== 'staging' && env !== 'production') {
  console.error('Error: Environment must be "staging" or "production"');
  process.exit(1);
}

const dbName = env === 'staging' ? 'ludo-arena-staging-db' : 'ludo-arena-prod-db';
const backupDir = 'backups';

if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
}

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupFile = join(backupDir, `ludo-arena-${env}-${timestamp}.sql`);

console.log(`📦 Backing up ${env.toUpperCase()} database (${dbName}) to ${backupFile}...`);

try {
  execSync(`npx wrangler d1 export "${dbName}" --env ${env} --output="${backupFile}"`, {
    stdio: 'inherit',
  });
  console.log(`✅ Backup saved to: ${backupFile}`);
} catch (error) {
  console.error(`❌ Backup failed for ${env}`);
  process.exit(1);
}

// Clean up backups older than 30 days
const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
try {
  const files = readdirSync(backupDir).filter((f) => f.endsWith('.sql'));
  for (const f of files) {
    const fullPath = join(backupDir, f);
    const stats = statSync(fullPath);
    if (stats.mtimeMs < thirtyDaysAgo) {
      unlinkSync(fullPath);
      console.log(`🧹 Removed old backup: ${f}`);
    }
  }
} catch {
  // Pruning is non-critical
}

console.log('Done!');
