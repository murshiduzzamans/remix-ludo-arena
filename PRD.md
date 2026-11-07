# Product Requirements Document (PRD) — Ludo Arena

## 1. Executive Summary

Ludo Arena is a premium, cross-platform Progressive Web App (PWA) delivering a classic digital board game experience with modern aesthetic standards and enterprise-grade architecture. Designed for desktop, Android, and iOS browsers, Ludo Arena provides local solo play against heuristic AI bots, cooperative 2v2 team gameplay, pass-and-play casual multiplayer, and private invitation rooms backed by an authoritative server state model.

---

## 2. Target Personas & User Stories

### Persona 1: Casual Player ("Alex")
- **Context**: Wants a quick, zero-friction game on mobile during a commute or break.
- **Needs**: Instant loading, offline capability, responsive touch targets, smooth bot opponents with natural decision speeds, and zero lag.
- **User Story**: *"As Alex, I want to launch Ludo Arena from my phone's home screen even without Wi-Fi, pick a quick Solo match, and play against realistic bots without waiting for other humans."*

### Persona 2: Competitive Family & Friends ("Sam & Team")
- **Context**: Looking to play a cooperative 2v2 board game on game night.
- **Needs**: Clear team indicators, shared victory states, safe squares, and no friendly-fire captures.
- **User Story**: *"As Sam, I want to partner with my friend against two opponents where our tokens can safely pass each other and our combined finish determines match victory."*

### Persona 3: Online Private Room Host ("Jordan")
- **Context**: Organizing a game with remote friends across different devices.
- **Needs**: Easy 6-character room codes, customizable house rules, clear ready indicators, and deterministic authoritative dice rolls.
- **User Story**: *"As Jordan, I want to create a private room, copy an invite code to WhatsApp or Discord, customize starting roll rules, and ensure the server authoritatively enforces fair play."*

---

## 3. Product Features & Scope

### 3.1 Game Modes
1. **Solo vs AI Bots (Tier 1 - Implemented & Fully Playable)**:
   - 1 Human vs 3 AI Bots.
   - 3 Configurable AI personalities: Aggressive (Hunter), Defensive (Guardian), and Balanced (Tactician).
   - Local standalone execution with zero server dependencies.
2. **2 vs 2 Team Ludo (Tier 1 - Implemented & Fully Playable)**:
   - Team Alpha (Red + Yellow) vs Team Omega (Green + Blue).
   - Teammates cannot capture each other.
   - Combined victory condition: first team to navigate all 8 tokens into the center triumph wins.
3. **Classic Pass & Play (Tier 1 - Implemented & Fully Playable)**:
   - 4-player turn rotation on a single physical screen.
4. **Private Rooms (Tier 1 UI & Protocol Spec / Planned Cloudflare DO Backend)**:
   - 6-character code generation (`LUDO-XXXX`).
   - Slot allocation, ready states, host controls, and transparent integration boundaries.
5. **Ranked Public Matchmaking (Tier 1 UI & Protocol Spec / Planned Cloudflare DO Backend)**:
   - Global queue view, elapsed timer, region tags, and cancel controls.

### 3.2 Core Gameplay Mechanics
- **Board Layout**: Standard 15×15 grid (600×600 SVG viewBox) with 52 perimeter cells, 4 starting cells, 8 safe star cells, 4 colored home columns (5 cells each), and 1 center triumph triangle per color.
- **Yard Exit Rule**: Default requirement is rolling a 6. Configurable option to allow 1 or 6.
- **Movement**: Clockwise path traversal with exact roll required to enter the center triumph.
- **Captures**: Landing on an opponent token on an un-safe square sends it back to the yard.
- **Bonus Turns**: Granted for rolling a 6, capturing an opponent, or bringing a pawn home.
- **Penalty**: 3 consecutive sixes forfeit the turn immediately.

### 3.3 Audio & Micro-Interactions
- Procedural Web Audio API sound generator (no external MP3 downloads required).
- Distinct sound profiles for dice tumble, pawn movement, capture strikes, home finishes, and victory fanfare.
- In-app mute and volume control with localStorage persistence.

### 3.4 PWA & Offline Readiness
- W3C Web App Manifest with `standalone` display mode, 192x192 and 512x512 icons.
- `usePWAInstall` hook handling Chromium `beforeinstallprompt` and iOS Safari installation guide modal.
- Standalone detection suppresses install buttons when already installed.
- Dynamic offline banner when network drops.

---

## 4. Non-Functional Requirements

- **Performance**: 60fps vector animations on modern mobile devices. Board rendering scales without pixelation from 320px to 4K.
- **Accessibility**: Touch targets $\ge 44\text{px}$ on mobile. High-contrast jewel tones on midnight obsidian canvas meeting WCAG AA contrast standards.
- **Zero Mock Fallbacks**: Local single-player runs on the actual pure engine. Online multiplayer is explicitly architected with transparent protocol contracts rather than fake client-side simulations.
