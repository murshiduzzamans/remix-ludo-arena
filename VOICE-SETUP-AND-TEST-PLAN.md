# Voice Chat — Cloudflare Setup & Manual Test Plan

The code for Phase 1 (text chat) and Phase 2 (voice) is complete. This is the
manual part: everything that must be done in the Cloudflare dashboard and on
real devices, plus the on-device test plan.

## 1. Cloudflare dashboard steps (do once)

1. **Create the RealtimeKit app.** Cloudflare dashboard → *Realtime → RealtimeKit
   → Create app*. Note the **App ID** (used as `REALTIMEKIT_APP_ID`).
2. **Create the voice-only preset.** In the RealtimeKit console, create a preset
   with **Meeting type = `Voice`** (audio-only). Disable video, screen share and
   recording — the game UI does not expose them. Note the **preset name** (used
   as `REALTIMEKIT_VOICE_PRESET`).
3. **Create an API token.** Cloudflare dashboard → *My Profile → API Tokens*
   (or the RealtimeKit API-keys section): create a token with Realtime/RealtimeKit
   permissions. This is `REALTIMEKIT_API_TOKEN`. Treat it as a password — never
   commit it.
4. **Note your Account ID.** Dashboard → right sidebar → *Account ID* — this is
   `CF_ACCOUNT_ID`.
5. **Choose an admin secret.** Generate a long random string (e.g.
   `openssl rand -hex 32`) — this is `VOICE_BUDGET_ADMIN_SECRET`.

## 2. Store the secrets

Local development — create `.dev.vars` in the project root (it is gitignored):

```
CF_ACCOUNT_ID=<account id>
REALTIMEKIT_APP_ID=<app id>
REALTIMEKIT_API_TOKEN=<api token>
REALTIMEKIT_VOICE_PRESET=<preset name>
VOICE_BUDGET_ADMIN_SECRET=<long random value>
```

Production — one command per secret (paste the value at the prompt):

```
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put REALTIMEKIT_APP_ID
npx wrangler secret put REALTIMEKIT_API_TOKEN
npx wrangler secret put REALTIMEKIT_VOICE_PRESET
npx wrangler secret put VOICE_BUDGET_ADMIN_SECRET
```

> **Windows gotcha (verified in this project):** piping the value from PowerShell
> into `wrangler secret put` (`$v | npx wrangler secret put ...`) corrupts every
> secret with a trailing `\r\n`, which then never matches at runtime (the admin
> endpoint returns 401 and voice joins fail). Use a no-newline ASCII temp file
> and pipe it through `cmd` instead:
>
> ```powershell
> Set-Content .tmp-secret.txt -Value '<value>' -NoNewline -Encoding ASCII
> cmd /c 'type .tmp-secret.txt | npx wrangler secret put SECRET_NAME'
> Remove-Item .tmp-secret.txt
> ```

Optional overrides (defaults in brackets):

```
VOICE_MONTHLY_MINUTE_LIMIT  [8000]
VOICE_ENABLED               [true on; set "false" to disable voice]
CHAT_ENABLED                [true on; set "false" to disable chat]
```

Deploy with `npm run deploy:worker`. Voice stays unavailable (`VOICE_UNAVAILABLE`)
until every `REALTIMEKIT_*` secret exists — by design the rest of the game (and
text chat) is unaffected.

## 3. Manual device test plan

Two devices with different browsers (iPhone Safari + Android Chrome ideal):

**Text chat**
1. Host creates a room on device A; device B joins with the code.
2. Send messages both ways — they appear in the dock with sender colour/name.
3. Send a reaction; verify it is quick-throttled when spammed.
4. Kill device B's tab, reopen with the same link — history is delivered on reconnect.
5. Mute a player on device A — their messages hide locally only.
6. Host disables chat (`chatEnabled=false`) — further messages get `CHAT_DISABLED`.

**Voice**
1. Device A taps *Join voice* — the browser asks only after the tap (iOS gesture);
   permission explanation is shown first; SDK loads lazily (check the network tab:
   the RealtimeKit chunk is not loaded before joining).
2. Both in voice — speech is two-way; speaking ring appears on the right player's
   panel; mic mute toggles both ways; muted state is remembered locally.
3. **Abrupt close:** force-kill one browser immediately. Within ~a minute the
   other player's voice bar drops that player (server-side participant removal
   keeps billing from running while nobody is connected).
4. Rejoin, then use chat and voice simultaneously.
5. Host disables voice — everyone leaves voice; the dock shows state without
   breaking the game or chat.
6. Deny the microphone once — a plain error shows; the game keeps working.

**Budget / usage**
1. After the session, query the global counter:
   ```
   curl -H "Authorization: Bearer <VOICE_BUDGET_ADMIN_SECRET>" \
     https://<your-worker>/api/admin/voice-budget
   ```
2. Compare `usedMinutes` with Cloudflare → Realtime → **Billable Usage** for the
   same UTC month. Minutes should be classed **Audio-Only**; per-participant
   sessions round up (a 20-second reserve that never activated costs 0).
3. Optional: watch for the `voice_budget_warning` banner (fires at 80% of the
   monthly limit within a room, once per month).

## 4. What is already verified by automated tests

`npm run lint` (tsc) and `npx vitest run` (159 tests) pass, including:
- one RealtimeKit meeting per room even for simultaneous joins; `Voice` preset +
  seat custom id always in the request body;
- max 4 simultaneous seats; 5 joins/minute/connection; `VOICE_ROOM_FULL`,
  `VOICE_RATE_LIMITED`, `VOICE_NOT_ALLOWED` (bots), `VOICE_DISABLED`,
  `VOICE_BUDGET_REACHED` paths;
- global monthly counter: 1-minute rounding, 0 for reserved-but-never-activated
  sessions, warning at 80%, reset on UTC month rollover;
- removal on leave, abrupt socket close, and the 3-hour session cap (alarm
  checkpoint); removal failure stays bounded (seat flagged `leaving`, no unbounded
  retries, room never crashes);
- host-only voice toggle removes everyone and is reversible;
- secrets never appear in room snapshots, API responses or admin output.
