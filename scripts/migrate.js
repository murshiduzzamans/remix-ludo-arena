#!/usr/bin/env node
/**
 * Cross-platform D1 migration runner
 * Usage: node scripts/migrate.js [staging|production]
 */

import { execSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const env = process.argv[2] || 'staging';
if (env !== 'staging' && env !== 'production') {
  console.error('Error: Environment must be "staging" or "production"');
  process.exit(1);
}

const dbName = env === 'staging' ? 'ludo-arena-staging-db' : 'ludo-arena-prod-db';
const migrationsDir = 'migrations';

if (!existsSync(migrationsDir)) {
  console.error(`Error: ${migrationsDir} directory not found.`);
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.error(`Error: No .sql migration files found in ${migrationsDir}.`);
  process.exit(1);
}

console.log(`🚀 Running ${files.length} D1 migrations for ${env.toUpperCase()} (${dbName})...\n`);

for (const file of files) {
  const filePath = join(migrationsDir, file);
  console.log(`⚙️  Applying: ${file}`);
  try {
    execSync(`npx wrangler d1 execute "${dbName}" --env ${env} --remote --file="${filePath}"`, {
      stdio: 'inherit',
    });
    console.log(`✅ Success: ${file}\n`);
  } catch (error) {
    console.error(`❌ Migration failed at ${file}`);
    process.exit(1);
  }
}

console.log(`🎉 All ${files.length} migrations completed successfully for ${env}!`);
