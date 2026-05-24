# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev                  # Start Vite frontend dev server at http://localhost:5173
npm run build                # TypeScript check + Vite production build → dist/

# Backend (Colyseus)
npm run build:server         # Compile src/server/ → dist-server/
npm run start:server         # Run compiled server at port 2567

# Tests
npm run test:e2e             # Run all Playwright E2E tests (auto-starts frontend + test server)
npx playwright test tests/love-letter-mp.spec.ts   # Run a single test file
npx playwright test --debug  # Debug mode with inspector

# Production preview
npm run preview              # Serve the dist/ build locally
```

## Architecture

### Two TypeScript Contexts

The project has two separate TypeScript compilation targets that **cannot mix imports**:

| Context | Config | Entry | Output |
|---|---|---|---|
| Browser / frontend | `tsconfig.json` | `src/main.ts` | bundled by Vite |
| Node / backend | `tsconfig.server.json` | `src/server/index.ts` | `dist-server/` |
| Playwright test server | `tsconfig.playwright-server.json` | `tests/support/colyseus-test-server.ts` | `.temp/colyseus-test/` |

The frontend imports `src/server/schema/GameRoomState.ts` directly — those schema classes are the one intentional cross-boundary shared code (Colyseus schema decorators work in both runtimes).

### Frontend (`src/main.ts`)

The entire frontend is a **single ~3700-line TypeScript file** with no UI framework. It mounts on `#app` in `index.html` and manages all scene transitions and game logic imperatively.

**Scene flow (one `<div>` is shown at a time):**
```
#main-menu → #mode-select → #bot-count-select → #game-scene   (local / offline)
                          → #lobby-scene → #room-wait-scene → #game-scene  (online)
```

**Key global state variables:**
- `state: GameState` — deck, players, current turn, logs, AI memory
- `localPlayerId` — 0 for local games, mapped from Colyseus session index for online games
- `selectedCardId` — which card the human has clicked (single selection)
- `isResolvingTurnAction` — guard flag that prevents concurrent card resolution
- `pendingForcedEffectsQueue` — Prince-triggered chain effects queued for online sync
- `pendingBaronDuel / pendingKingExchange` — multi-client confirmation state for reveal modals

**Rendering:** `render()` is a full re-render called after every state mutation. There is no virtual DOM — it clears and rebuilds opponent areas, player hand, discard pile, and log on every call.

**Turn lifecycle:**
1. `drawCard()` → player/bot draws from `state.deck`
2. `handlePlayCardRequest()` → validates Countess constraint and Princess restriction
3. `executePlayCard()` → moves card from hand to discard, calls `applyEffect()`
4. `applyEffect()` → dispatches to modal UI (human) or direct call (bot); chains into `resolveTargetEffect()`
5. `endTurn()` → advances `currentTurnPlayerId`, triggers `botTurn()` for AI

### AI Logic

AI bots share the same `applyEffect` / `resolveTargetEffect` path as the human player — `player.isBot` flags control which branches run (modal vs. direct).

- `state.aiMemory[botId][targetId]` — remembers a target's card type (updated by Priest, King exchange, Baron tie)
- `state.aiExcludedGuesses[botId][targetId]` — remembers failed Guard guesses to avoid re-guessing
- `recentBaronGuardClue` — when a Baron duel ends, the winner's inferred card range is stored; AI uses this to weight Guard guesses higher and target that player
- `chooseAICardToPlay()` uses weighted random selection; `getAICardPlayWeight()` contains the strategy rules

### Multiplayer (Colyseus)

**Server rooms** (`src/server/`):
- `lobby` (built-in `LobbyRoom`) — broadcasts room list updates; client subscribes via `onAdd`/`onRemove`
- `love_letter` (`LoveLetterRoom`) — manages join/ready/start lifecycle only. **Game logic runs entirely on the frontend.**

**State sync model:** The host client owns the authoritative game state. Every mutation calls `syncOnlineGameState()`, which sends the full `OnlineGameStateData` blob via `room.send("sync_game_state", ...)`. Non-host clients receive it and call `applyOnlineGameState()` to overwrite their local state.

**Bots in online rooms:** The host can add AI bots (電腦 A/B/C) to fill empty slots. `GameRoomState.botCount` (Colyseus schema field) tracks how many bots are in the room. `createInitialOnlineGameData()` appends bot `Player` entries when the game starts. Bot turns run only on the host client — `queueBotTurn()` checks `selfPlayer?.isHost` and returns early on non-host clients.

**Private information:** Cards have `privateActionHints` / `privateHintOwnerId` fields that are stripped before sync (`cloneCardForOnlineSync`). After receiving an online state update, `restoreLocalPrivateHints()` re-attaches hints that belong to the local player.

**Reconnection:** After game start, `LoveLetterRoom.onLeave` calls `allowReconnection(client, 20)`. On reconnect the client sends `"request_game_data"` and the server replays `latestGameState`.

**Colyseus endpoint:** Resolved from `VITE_COLYSEUS_ENDPOINT` env var at build time; falls back to `ws(s)://<hostname>:2567` at runtime.

### Audio System

Five MP3 files live in `public/audio/`. Two `Audio` objects are shared globally: `bgmAudio` (looping BGM) and `sfxAudio` (one-shot SFX).

- `playBGM(filename)` — switches BGM track; no-ops if the same file is already committed (`currentBGMFile === filename`). While `audioUnlocked` is false, stores the filename in `pendingBGMFile` for deferred play.
- `playSFX(filename)` — pauses BGM, plays SFX, resumes BGM via `onended`. Uses `bgmPausedForSFX` flag to avoid double-resume.
- `playChampionTheme()` — plays the victory track on `sfxAudio` without resuming BGM.
- `unlockAudio()` — called on the first user gesture (registered with `capture: true, once: true` on `touchstart`, `click`, and `keydown`). Capture phase ensures it fires before any button handler.
- BGM switches: `showScene('game-scene')` → `A Game of Hearts.mp3`; all other scenes → `Royal Intrigue.mp3`.
- SFX triggers: elimination → `Farewell, Chevalier.mp3`; end-game modal → `The Victor's Token.mp3`; champion modal → `Love Conquers All.mp3`.

**Mute button:** Two instances exist — `#mute-btn` (inside the game sidebar's `.back-home-row`, `position: absolute`) and `#mute-btn-global` (fixed top-right, hidden via `body.game-scene-active #mute-btn-global { display: none }`). `applyMuteState()` syncs both. Mute preference persists to `localStorage` under key `loveLetter_muted`.

### Deployment

GitHub Actions (`.github/workflows/deploy.yml`) runs on push to `main`:
1. `npm run build` with `VITE_COLYSEUS_ENDPOINT` injected from a GitHub Actions variable
2. Uploads `dist/` to GitHub Pages

The Colyseus backend is deployed separately (Render). The `vite.config.ts` sets `base: '/love-letter/'` for GitHub Pages path prefix.

## Environment Variables

| Variable | Where used | Purpose |
|---|---|---|
| `VITE_COLYSEUS_ENDPOINT` | Frontend build / runtime | WebSocket URL for the Colyseus backend |
| `PORT` / `COLYSEUS_PORT` | Backend server | Listening port (default: 2567) |
| `HOST` | Backend server | Bind address (default: `0.0.0.0`) |
| `CORS_ORIGIN` | Backend server | Allowed CORS origin (default: `*`) |
