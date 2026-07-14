import { CloseCode, type Client, Room, ServerError } from "colyseus";
import { GameRoomState } from "../schema/GameRoomState.js";
import { PlayerState } from "../schema/PlayerState.js";

interface CreateRoomOptions {
    password?: string;
}

interface JoinRoomOptions {
    name?: string;
    password?: string;
}

class LobbyException extends ServerError {
    constructor(message: string, code = 400) {
        super(code, message);
    }
}

export class LoveLetterRoom extends Room<{ state: GameRoomState }> {
    private password: string | null = null;
    private initialGameData: unknown | null = null;
    private latestGameState: unknown | null = null;
    /** 目前在語音頻道內的 sessionId 集合 */
    private voiceSessionIds = new Set<string>();
    /** Per-session message-rate tracking: sessionId → message type → recent timestamps. */
    private messageTimestamps = new Map<string, Map<string, number[]>>();

    async onCreate(options: CreateRoomOptions = {}) {
        this.maxClients = 4;

        this.password = options.password?.trim() || null;

        const state = new GameRoomState();
        state.roomId = this.roomId;
        state.hasPassword = this.password !== null;
        this.setState(state);
        await this.setMetadata({
            hasPassword: state.hasPassword,
            isGameStarted: state.isGameStarted,
            botCount: state.botCount
        });

        this.onMessage("toggle_ready", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            player.isReady = !player.isReady;
        });

        this.onMessage("start_game", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can start the game.", 403);
            }

            const players = Array.from(this.state.players.values()) as PlayerState[];
            const totalPlayers = players.length + this.state.botCount;
            if (totalPlayers < 2 || totalPlayers > 4) {
                throw new LobbyException("The game requires 2 to 4 players (including bots).");
            }

            const guestsReady = players
                .filter(roomPlayer => !roomPlayer.isHost)
                .every(roomPlayer => roomPlayer.isReady);

            if (!guestsReady) {
                throw new LobbyException("All non-host players must be ready before starting.");
            }

            this.state.isGameStarted = true;
            void this.setMetadata({ isGameStarted: true });
            this.lock();
        });

        this.onMessage("add_bot", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can add bots.", 403);
            }
            if (this.state.isGameStarted) {
                throw new LobbyException("Cannot add bots after the game has started.");
            }
            const totalSlots = this.state.players.size + this.state.botCount;
            if (totalSlots >= this.maxClients) {
                throw new LobbyException("Room is full.");
            }
            this.state.botCount++;
            this.state.botDifficulties.push("hard");
            void this.setMetadata({ botCount: this.state.botCount });
            console.log(`[LoveLetterRoom] Bot added to room ${this.roomId}. Bot count: ${this.state.botCount}`);
        });

        this.onMessage("remove_bot", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can remove bots.", 403);
            }
            if (this.state.isGameStarted) {
                throw new LobbyException("Cannot remove bots after the game has started.");
            }
            if (this.state.botCount <= 0) {
                throw new LobbyException("No bots to remove.");
            }
            this.state.botCount--;
            this.state.botDifficulties.pop();
            void this.setMetadata({ botCount: this.state.botCount });
            console.log(`[LoveLetterRoom] Bot removed from room ${this.roomId}. Bot count: ${this.state.botCount}`);
        });

        this.onMessage("set_bot_difficulty", (client, data: { index: number; difficulty: string }) => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) throw new LobbyException("Only the host can set bot difficulty.", 403);
            if (this.state.isGameStarted) throw new LobbyException("Cannot change difficulty after the game has started.");
            const valid = ['easy', 'medium', 'hard'];
            if (typeof data?.index !== 'number' || data.index < 0 || data.index >= this.state.botCount) {
                throw new LobbyException("Invalid bot index.");
            }
            if (!valid.includes(data?.difficulty)) throw new LobbyException("Invalid difficulty value.");
            this.state.botDifficulties[data.index] = data.difficulty;
        });

        this.onMessage("set_champion_coins", (client, data: { value: number }) => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) throw new LobbyException("Only the host can set champion coins.", 403);
            if (this.state.isGameStarted) throw new LobbyException("Cannot change champion coins after the game has started.");
            const v = data?.value;
            if (typeof v !== 'number' || v < 1 || v > 10) throw new LobbyException("Champion coins must be between 1 and 10.");
            this.state.championCoins = v;
        });

        this.onMessage("kick_player", (client, data: { targetSessionId: string }) => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can kick players.", 403);
            }
            if (this.state.isGameStarted) {
                throw new LobbyException("Cannot kick players after the game has started.");
            }
            if (!data?.targetSessionId || data.targetSessionId === client.sessionId) {
                throw new LobbyException("Invalid kick target.");
            }
            const targetPlayer = this.state.players.get(data.targetSessionId);
            if (!targetPlayer) {
                throw new LobbyException("Target player not found.");
            }

            // Notify the kicked client before removing them.
            const targetClient = this.clients.find(c => c.sessionId === data.targetSessionId);
            if (targetClient) {
                targetClient.send("kicked_from_room", {});
            }

            this.state.players.delete(data.targetSessionId);

            // Force-close the connection server-side. Relying on the client to
            // leave voluntarily let a malicious client ignore the message and
            // keep receiving every room broadcast (state, chat) after the kick.
            // The state entry is already deleted, so this client's onLeave
            // returns early and no reconnection window is granted.
            targetClient?.leave();
            console.log(`[LoveLetterRoom] ${targetPlayer.name} was kicked from room ${this.roomId} by the host.`);
        });

        this.onMessage("forfeit_game", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!this.state.isGameStarted) {
                throw new LobbyException("Game has not started yet.");
            }
            player.hasForfeited = true;
            console.log(`[LoveLetterRoom] ${player.name} forfeited from room ${this.roomId}.`);
        });

        this.onMessage("init_game_data", (client, data) => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can initialize the game.", 403);
            }

            if (!this.state.isGameStarted) {
                throw new LobbyException("Cannot initialize the game before it starts.");
            }

            this.initialGameData = data;
            this.latestGameState = data;
            this.broadcast("init_game_data", data);
        });

        this.onMessage("sync_game_state", (client, data) => {
            this.getPlayerOrThrow(client.sessionId);
            if (!this.state.isGameStarted) {
                throw new LobbyException("Cannot sync game state before the game starts.");
            }

            // Anti-flood only: the ceiling is far above any legitimate burst
            // (effect chains peak at ~10-20 syncs over a few seconds), so a
            // dropped sync always means a misbehaving client, never a soft-lock.
            if (!this.allowMessage(client.sessionId, "sync", 120, 10_000)) {
                return;
            }

            // Lightweight anti-forgery guard. The game logic still runs on clients
            // (trusted-peer model), so this only rejects physically-impossible
            // transitions — never authoritative validation. Dropping a forged sync
            // here stops the most blatant griefing (fabricated cards, instant
            // champion) without the soft-lock risk of a host-only restriction.
            if (!this.isPlausibleStateUpdate(this.latestGameState, data)) {
                console.warn(
                    `[LoveLetterRoom] Rejected implausible sync_game_state from ${client.sessionId} ` +
                    `in room ${this.roomId}.`
                );
                return; // do not store or broadcast a forged/corrupt state
            }

            this.latestGameState = data;
            // Exclude the sender: the host owns authoritative state and does not
            // need its own echo. Broadcasting back to the host would needlessly
            // overwrite aiMemory/aiExcludedGuesses (always reset to {} in
            // applyOnlineGameState) after every sync.
            this.broadcast("sync_game_state", data, { except: client });
        });

        this.onMessage("request_game_data", client => {
            this.getPlayerOrThrow(client.sessionId);
            const gameData = this.latestGameState ?? this.initialGameData;
            if (gameData) {
                client.send("init_game_data", gameData);
            }
        });

        // ── WebRTC 語音信令 ──────────────────────────────────────────────────

        // 加入語音頻道：回傳現有參與者給新加入者，並廣播給其他人
        this.onMessage("webrtc_join_voice", client => {
            // Legitimate clients join/leave voice a handful of times per game;
            // the ceiling only stops broadcast spam from a modified client.
            if (!this.allowMessage(client.sessionId, "voice", 10, 10_000)) return;
            const existing = [...this.voiceSessionIds];
            this.voiceSessionIds.add(client.sessionId);
            client.send("webrtc_voice_state", { type: 'you_joined', existingParticipants: existing });
            this.broadcast("webrtc_voice_state", { type: 'peer_joined', sessionId: client.sessionId }, { except: client });
        });

        // 離開語音頻道
        this.onMessage("webrtc_leave_voice", client => {
            if (!this.allowMessage(client.sessionId, "voice", 10, 10_000)) return;
            this.voiceSessionIds.delete(client.sessionId);
            this.broadcast("webrtc_voice_state", { type: 'peer_left', sessionId: client.sessionId }, { except: client });
        });

        // P2P 信令中繼（offer / answer / ice candidate）
        this.onMessage("webrtc_signal", (client, data: { to: string; type: string; payload: unknown }) => {
            // Trickle ICE to 3 peers legitimately bursts a few dozen messages;
            // the ceiling only stops a client relaying floods at socket speed.
            if (!this.allowMessage(client.sessionId, "signal", 120, 10_000)) return;
            const target = this.clients.find(c => c.sessionId === data.to);
            if (target) {
                target.send("webrtc_signal", { from: client.sessionId, type: data.type, payload: data.payload });
            }
        });

        // 表情反應：廣播給房間所有人（包含發送者）。
        // playerId 一律由伺服器依發送者的 session 推導（玩家在 players map 中的
        // 插入順序索引，與前端建立遊戲玩家的順序一致），不信任 payload ——
        // 否則任何 client 都能冒用別人的座位發表情。
        this.onMessage("emoji_react", (client, data: { emoji: string }) => {
            if (!this.state.isGameStarted) return;
            // The client enforces a 3 s cooldown; this only stops modified clients.
            if (!this.allowMessage(client.sessionId, "emoji", 8, 10_000)) return;
            const validEmojis = ['😊', '😡', '😢', '🤔', '❌', '💯'];
            if (!validEmojis.includes(data?.emoji)) return;
            const senderIndex = Array.from(this.state.players.keys()).indexOf(client.sessionId);
            if (senderIndex < 0) return;
            this.broadcast("emoji_react", { emoji: data.emoji, playerId: senderIndex });
        });

        // 文字聊天：廣播給房間所有人（包含發送者，保持一致性）
        this.onMessage("chat_message", (client, data: { text: string }) => {
            if (!this.allowMessage(client.sessionId, "chat", 10, 10_000)) return;
            const player = this.state.players.get(client.sessionId);
            const name = player?.name ?? '???';
            const text = typeof data?.text === 'string' ? data.text.trim().slice(0, 200) : '';
            if (!text) return;
            this.broadcast("chat_message", {
                sessionId: client.sessionId,
                name,
                text,
                timestamp: Date.now()
            });
        });

        console.log(`[LoveLetterRoom] Created room ${this.roomId}. Password protected: ${state.hasPassword}`);
    }

    onJoin(client: Client, options: JoinRoomOptions = {}) {
        if (this.state.isGameStarted) {
            throw new LobbyException("Cannot join a game that has already started.", 403);
        }

        if (this.password !== null && options.password !== this.password) {
            throw new LobbyException("Invalid room password.", 401);
        }

        if (this.state.players.has(client.sessionId)) {
            throw new LobbyException("Player is already in this room.");
        }

        if (this.state.players.size + this.state.botCount >= this.maxClients) {
            throw new LobbyException("Room is full.", 403);
        }

        const player = new PlayerState();
        player.id = client.sessionId;
        player.name = this.sanitizePlayerName(options.name) || `Player ${this.state.players.size + 1}`;
        player.isHost = this.state.players.size === 0;
        player.isReady = false;
        player.isConnected = true;

        this.state.players.set(client.sessionId, player);

        console.log(`[LoveLetterRoom] ${player.name} joined room ${this.roomId}. Host: ${player.isHost}`);
    }

    async onLeave(client: Client, consented?: boolean | number) {
        // Rate-limit bookkeeping is per-connection; drop it on leave. A player who
        // reconnects starts with a fresh window, which is fine.
        this.messageTimestamps.delete(client.sessionId);

        // WebRTC 不支援重連，斷線時立即清除語音狀態並通知其他人
        if (this.voiceSessionIds.has(client.sessionId)) {
            this.voiceSessionIds.delete(client.sessionId);
            this.broadcast("webrtc_voice_state", { type: 'peer_left', sessionId: client.sessionId }, { except: client });
        }

        const leavingPlayer = this.state.players.get(client.sessionId);
        if (!leavingPlayer) return;

        if (this.state.isGameStarted) {
            leavingPlayer.isConnected = false;
            leavingPlayer.isReady = false;

            console.log(
                `[LoveLetterRoom] ${leavingPlayer.name} disconnected during game ${this.roomId}. ` +
                `Consented/code: ${String(consented)}. Keeping player slot for game-state stability.`
            );

            // Colyseus calls onLeave(client, CloseCode.CONSENTED) (= 4000) for voluntary leaves,
            // not the boolean `true`. Handle both forms to be safe.
            if (consented === true || consented === CloseCode.CONSENTED) {
                // Voluntary leave during a game: mark the player as forfeited so
                // non-host clients can immediately detect the game is over.
                leavingPlayer.hasForfeited = true;
                this.disposeStartedRoomIfEveryoneLeft("all players left voluntarily");
                return;
            }

            try {
                await this.allowReconnection(client, 60);
                const reconnectedPlayer = this.state.players.get(client.sessionId);
                if (reconnectedPlayer) {
                    reconnectedPlayer.isConnected = true;
                    console.log(`[LoveLetterRoom] ${reconnectedPlayer.name} reconnected to room ${this.roomId}.`);
                }
            } catch {
                const timedOutPlayer = this.state.players.get(client.sessionId);
                if (timedOutPlayer) {
                    timedOutPlayer.isConnected = false;
                    timedOutPlayer.isReady = false;
                    console.log(
                        `[LoveLetterRoom] ${timedOutPlayer.name} did not reconnect to room ${this.roomId} within 60 seconds. ` +
                        `Player slot remains reserved.`
                    );
                }
                this.disposeStartedRoomIfEveryoneLeft("all players disconnected");
            }
            return;
        }

        const wasHost = leavingPlayer.isHost;
        this.state.players.delete(client.sessionId);

        if (wasHost) {
            this.transferHostToNextPlayer();
        }

        if (this.state.players.size === 0) {
            console.log(`[LoveLetterRoom] Room ${this.roomId} is empty and will be disposed by Colyseus.`);
        } else {
            console.log(
                `[LoveLetterRoom] ${leavingPlayer.name} left room ${this.roomId}. ` +
                `Consented/code: ${String(consented)}. Remaining players: ${this.state.players.size}`
            );
        }
    }

    /**
     * Strip tag-forming characters from a player-supplied nickname and cap its
     * length. The name is broadcast to every client and rendered in their DOM,
     * so removing `<`/`>` at this trust boundary prevents stored XSS. Removal
     * (not entity-encoding) keeps the name displaying identically whether a
     * client renders it via innerHTML or textContent.
     */
    private sanitizePlayerName(raw?: string): string {
        return (raw ?? '')
            .replace(/[<>]/g, '')
            .trim()
            .slice(0, 24);
    }

    /**
     * Reject only state transitions that are impossible in a legitimate game, so
     * this must have ZERO false positives — a wrongly dropped sync would soft-lock
     * the round. Anything unparseable (or any unexpected error) fails OPEN (allows
     * the sync), trading completeness for safety. This is a coarse griefing filter,
     * NOT a substitute for server-authoritative logic.
     */
    private isPlausibleStateUpdate(prev: unknown, next: unknown): boolean {
        try {
            if (!next || typeof next !== "object") return true; // unknown shape → allow

            // 1) Card conservation: a 16-card deck can never expand to more than 16
            //    cards across deck + burned + every hand + every discard. A higher
            //    count means cards were fabricated.
            const totalCards = this.countCards(next);
            if (totalCards !== null && totalCards > 16) return false;

            // 2) Coin monotonicity: at most one round resolves per sync (each round
            //    end immediately syncs over a reliable WebSocket), so a player can
            //    gain at most one coin between two server-observed states. A jump of
            //    +2 or more is a forged win. Decreases are allowed — a new league
            //    legitimately resets every coin to 0.
            const prevCoins = this.coinsById(prev);
            const nextCoins = this.coinsById(next);
            if (prevCoins && nextCoins) {
                for (const [id, coins] of nextCoins) {
                    const before = prevCoins.get(id);
                    if (before !== undefined && coins > before + 1) return false;
                }
            }

            return true;
        } catch {
            return true; // never let a guard bug break a legitimate game
        }
    }

    /** Count every physical card in a synced state, or null if the shape is unexpected. */
    private countCards(state: unknown): number | null {
        const s = state as { deck?: unknown; burnedCard?: unknown; players?: unknown };
        if (!Array.isArray(s.deck) || !Array.isArray(s.players)) return null;
        let total = s.deck.length + (s.burnedCard ? 1 : 0);
        for (const player of s.players) {
            const p = player as { hand?: unknown; discardPile?: unknown };
            if (!Array.isArray(p.hand) || !Array.isArray(p.discardPile)) return null;
            total += p.hand.length + p.discardPile.length;
        }
        return total;
    }

    /** Map of player id → coin count from a synced state, or null if unparseable. */
    private coinsById(state: unknown): Map<number, number> | null {
        const players = (state as { players?: unknown })?.players;
        if (!Array.isArray(players)) return null;
        const map = new Map<number, number>();
        for (const player of players) {
            const p = player as { id?: unknown; coins?: unknown };
            if (typeof p.id === "number" && typeof p.coins === "number") {
                map.set(p.id, p.coins);
            }
        }
        return map;
    }

    /**
     * Sliding-window rate limiter for client messages. Returns true when the
     * message is within limits; false means "silently drop it". Limits are set
     * well above what a legitimate client produces, so a drop only ever
     * punishes flooding (never breaks a real game).
     */
    private allowMessage(sessionId: string, type: string, limit: number, windowMs: number): boolean {
        const now = Date.now();
        let byType = this.messageTimestamps.get(sessionId);
        if (!byType) {
            byType = new Map();
            this.messageTimestamps.set(sessionId, byType);
        }
        const timestamps = (byType.get(type) ?? []).filter(ts => now - ts < windowMs);
        if (timestamps.length >= limit) {
            byType.set(type, timestamps);
            return false;
        }
        timestamps.push(now);
        byType.set(type, timestamps);
        return true;
    }

    private getPlayerOrThrow(sessionId: string): PlayerState {
        const player = this.state.players.get(sessionId);
        if (!player) {
            throw new LobbyException("Player is not in this room.", 404);
        }

        return player;
    }

    private transferHostToNextPlayer() {
        const nextHost = this.state.players.values().next().value as PlayerState | undefined;
        if (!nextHost) return;

        nextHost.isHost = true;
        nextHost.isReady = false;

        console.log(`[LoveLetterRoom] Host transferred to ${nextHost.name} in room ${this.roomId}.`);
    }

    private disposeStartedRoomIfEveryoneLeft(reason: string) {
        if (!this.state.isGameStarted) return;

        const players = Array.from(this.state.players.values()) as PlayerState[];
        if (players.length === 0 || players.some(player => player.isConnected)) return;

        console.log(`[LoveLetterRoom] Disposing room ${this.roomId}: ${reason}.`);
        this.disconnect();
    }
}
