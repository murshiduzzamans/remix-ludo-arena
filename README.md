# LUDO ARENA 🏆

> Premium, responsive multiplayer and solo AI Ludo board game Progressive Web App (PWA).

Ludo Arena is built on modern web standards: a **pure TypeScript decoupled game engine**, responsive vector SVG board geometry, procedural Web Audio sound synthesis, intelligent bot strategies, and an authoritative multiplayer protocol architecture designed for **Cloudflare Workers + Durable Objects + WebSockets**.

---

## 🌟 Key Features

1. **Pure TypeScript Authoritative Engine (`/src/engine`)**:
   - Zero React dependencies. Can run seamlessly on the client, in headless Vitest tests, or inside Cloudflare Durable Objects.
   - Deterministic rule verification, exact roll home finishes, 8 safe star squares, capture bonus turns, and consecutive six penalties.

2. **Responsive SVG Board Rendering (`/src/components/board`)**:
   - Crisp mathematical 15×15 grid mapped to a `600×600` vector viewBox.
   - Obsidian midnight aesthetic with jewel-tone Ruby Red, Emerald Green, Amber Gold, and Sapphire Blue quadrants.
   - Playable pawn aura pulses and stacked piece micro-offsets.

3. **Intelligent Solo AI Opponents (`/src/engine/botEngine.ts`)**:
   - **Aggressive Hunter**: Prioritizes strikes, hunts vulnerable tokens, and takes calculated risks.
   - **Defensive Guardian**: Rushes home stretch, seeks sanctuary on safe stars, and minimizes risk.
   - **Balanced Tactician**: Dynamically evaluates risk/reward, board presence, and finish lines.

4. **Multiplayer & Cooperative Modes**:
   - **Solo vs Bots**: Practice against 3 customizable AI playstyles.
   - **2 vs 2 Team Ludo**: Red + Yellow (Team Alpha) vs Green + Blue (Team Omega). Teammates cannot capture each other!
   - **Classic Pass & Play**: Local multiplayer on a shared mobile, tablet, or desktop screen.
   - **Private Friend Rooms**: Share a room link or code; a Cloudflare Durable Object keeps players and game state in sync.
   - **Public Matchmaking**: Still a local preview; it requires a separate global queue service.

5. **PWA Compliance & Offline Capability**:
   - Web App Manifest, maskable and standard app icons, and in-app install button.
   - Automatic offline detection with fallback to the local pure engine.

6. **Web Audio Procedural Sound Synthesizer (`/src/audio`)**:
   - Zero-dependency sound effects generated with Web Audio API oscillators: dice rattle, jewel pawn clicks, capture impact thuds, and victory fanfare.

## 🎮 Play with Friends

Private rooms use the Cloudflare Worker and SQLite-backed Durable Object in `worker/index.ts`.

### Run locally

1. `.env.development.local` points the development app at `http://localhost:8787`.
2. In one terminal run `npm run dev:worker`.
3. In another terminal run `npm run dev` and open the Vite URL.
4. Choose **With Friends**, create a room, then send friends the invite link or room code. Friends open the link, enter a name, join, and mark ready. The host starts the match once another player is ready.

The room host can start with two or more people. Empty seats are controlled by the room server's bots. Room and game state stays on the server; player tokens are private reconnect credentials stored in that browser.

### Deploy the room server

1. Sign in to Cloudflare from the project terminal with `npx wrangler login`.
2. Run `npm run deploy:worker`. This builds the frontend and deploys it with the room Worker and Durable Object as one site.
3. Share the deployed `workers.dev` URL. Room invite links use that same URL with `?room=<code>`.

The deployed app uses its own origin for API and WebSocket requests, so no production API variable is needed. This repository does not contain Cloudflare account credentials; deploying to a permanent account requires signing in first.

---

## 🗂 Project Architecture

```
ludo-arena/
├── public/                     # PWA assets (icon.svg, manifest.json)
├── src/
│   ├── audio/                  # Web Audio API sound synthesizer
│   │   └── soundEffects.ts
│   ├── components/
│   │   ├── board/              # Vector SVG Ludo board components
│   │   │   ├── BoardCenter.tsx
│   │   │   ├── BoardQuadrant.tsx
│   │   │   ├── BoardTrack.tsx
│   │   │   ├── LudoBoard.tsx
│   │   │   └── PawnPiece.tsx
│   │   ├── game/               # Gameplay controls & HUD
│   │   │   ├── DiceRoller.tsx
│   │   │   ├── GameLog.tsx
│   │   │   └── PlayerSeat.tsx
│   │   ├── navigation/         # Header & 3-zone Top Bar
│   │   │   └── TopNavBar.tsx
│   │   ├── pwa/                # PWA install banner & offline status
│   │   │   ├── PWAInstallBanner.tsx
│   │   │   └── usePWAInstall.ts
│   │   └── screens/            # Application views
│   │       ├── BoardGameScreen.tsx
│   │       ├── LobbyScreen.tsx
│   │       ├── MatchmakingScreen.tsx
│   │       ├── ProfileScreen.tsx
│   │       ├── ResultsModal.tsx
│   │       ├── RoomLobbyScreen.tsx
│   │       ├── SettingsScreen.tsx
│   │       └── SoloSetupScreen.tsx
│   ├── engine/                 # PURE TYPESCRIPT GAME ENGINE
│   │   ├── boardCoordinates.ts # (col, row) & (x, y) 600x600 coordinate maps
│   │   ├── botEngine.ts        # Heuristic AI bot decision logic
│   │   ├── constants.ts        # Color themes, safe cells, track geometry
│   │   ├── gameEngine.ts       # Master state transition reducer & rules
│   │   ├── rules.ts            # Move validator & capture detection
│   │   └── types.ts            # Shared TypeScript contracts
│   ├── network/                # Authoritative WebSocket protocol schema
│   │   └── protocol.ts
│   ├── storage/                # LocalStorage profile & stats persistence
│   │   └── profileStore.ts
│   ├── App.tsx                 # Root application & screen router
│   ├── index.css               # Tailwind CSS & board animations
│   └── main.tsx                # React 19 entry point
├── architecture.md             # System architecture & Cloudflare integration guide
├── game-rules.md               # Complete official Ludo Arena rulebook
├── multiplayer-protocol.md     # Authoritative WebSocket API specification
├── PRD.md                      # Product Requirements Document
├── testing-plan.md             # Vitest & Playwright testing strategy
└── package.json
```

---

## 🚀 How to Run Locally & Export to GitHub

### 1. Prerequisites
- Node.js 18+ or 20+
- npm, pnpm, or yarn

### 2. Exporting to GitHub
1. In the AI Studio interface, use the GitHub export feature or clone your repository:
   ```bash
   git init
   git add .
   git commit -m "feat: initial Ludo Arena PWA foundation"
   git remote add origin https://github.com/YOUR_USERNAME/ludo-arena.git
   git push -u origin main
   ```

### 3. Local Development
```bash
# Install dependencies
npm install

# Start Vite development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) or [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Build for Production
```bash
npm run build
npm run preview
```

---

## 📖 Complete Documentation Index

- [Product Requirements Document (PRD.md)](./PRD.md)
- [System Architecture & Backend Blueprint (architecture.md)](./architecture.md)
- [Official Game Rules (game-rules.md)](./game-rules.md)
- [Authoritative WebSocket Protocol (multiplayer-protocol.md)](./multiplayer-protocol.md)
- [Unit & E2E Testing Plan (testing-plan.md)](./testing-plan.md)
