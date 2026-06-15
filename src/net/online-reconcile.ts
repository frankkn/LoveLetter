import type { Card } from '../domain/cards.js';
import type { GameState, Player } from '../domain/game-state.js';
import { cloneCardForOnlineSync, isHiddenOnlineCard } from './online-serialization.js';

// 收到線上同步資料後，與本地既有狀態「對帳」的工具：
// host 端補回機器人真實手牌、本地玩家私密提示的還原、增量 log 的合併。
// 依賴的本地狀態（state / localPlayerId / isHost）皆以參數顯式傳入。

/**
 * Host 端專用：sync 廣播會把機器人手牌遮成 "?"，回灌時用本地保有的真實手牌補回，
 * 確保 host 仍掌握完整機器人手牌以驅動 bot 回合。
 */
export function preserveHostBotHands(state: GameState, players: Player[], isHost: boolean): Player[] {
    if (!isHost || !state?.players?.length || state.isGameOver) {
        return players;
    }

    const currentBotPlayers = new Map(
        state.players
            .filter(player => player.isBot)
            .map(player => [player.id, player])
    );

    return players.map(player => {
        if (!player.isBot || !player.hand.some(isHiddenOnlineCard)) {
            return player;
        }

        const currentBot = currentBotPlayers.get(player.id);
        if (!currentBot) {
            return player;
        }

        return {
            ...player,
            hand: currentBot.hand.map(cloneCardForOnlineSync)
        };
    });
}

/**
 * 私密提示不隨 sync 廣播，回灌後用本地舊狀態把屬於自己的私密提示重新貼回。
 *
 * 還原是用 card.id 配對的，而 id 在同一回合內唯一、不同回合間可能重複（即使現在
 * 已改為全域唯一，仍保留這層防護）。一旦跨回合（incomingRoundIndex 與本地 state
 * 的 roundIndex 不同），就完全不還原 —— 新回合的牌不應該繼承上一回合的私密提示。
 */
export function restoreLocalPrivateHints(
    state: GameState,
    localPlayerId: number,
    players: Player[],
    incomingRoundIndex?: number
): Player[] {
    // Round transition: never carry a previous round's private hints onto new
    // cards. Defends against id-collision reattachment across rounds.
    if (
        typeof incomingRoundIndex === 'number' &&
        typeof state?.roundIndex === 'number' &&
        incomingRoundIndex !== state.roundIndex
    ) {
        return players;
    }

    const previousLocalPlayer = state.players[localPlayerId];
    const incomingLocalPlayer = players[localPlayerId];
    if (!previousLocalPlayer || !incomingLocalPlayer) return players;

    const privateHintsByCardId = new Map<string, Pick<Card, 'privateActionHints' | 'privateHintOwnerId'>>();
    [...previousLocalPlayer.hand, ...previousLocalPlayer.discardPile].forEach(card => {
        if (card.privateHintOwnerId === localPlayerId && card.privateActionHints?.length) {
            privateHintsByCardId.set(card.id, {
                privateActionHints: card.privateActionHints.map(hint => ({ ...hint })),
                privateHintOwnerId: card.privateHintOwnerId
            });
        }
    });

    const restoreCard = (card: Card): Card => {
        const privateHint = privateHintsByCardId.get(card.id);
        return privateHint ? { ...card, ...privateHint } : card;
    };

    incomingLocalPlayer.hand = incomingLocalPlayer.hand.map(restoreCard);
    incomingLocalPlayer.discardPile = incomingLocalPlayer.discardPile.map(restoreCard);
    return players;
}

// Merge an incoming log payload (which may be a tail-only delta) against the
// receiver's current logs. Mirrors the host's delta logic in reverse.
export function mergeOnlineLogs(localLogs: string[], incomingLogs: string[], baseIndex: number | undefined): string[] {
    const base = baseIndex ?? 0;
    if (base <= 0) return [...incomingLogs];                  // full snapshot → replace
    const local = localLogs;
    if (local.length === base) return [...local, ...incomingLogs];        // exact append
    if (local.length > base) return [...local.slice(0, base), ...incomingLogs]; // rebuild from base (rollback/replay)
    // Gap: we missed entries between local.length and base (e.g. syncs skipped
    // during a Baron/King interaction). Display-only; mark the omission and
    // append the tail. Self-heals on the next round reset.
    return [...local, '…', ...incomingLogs];
}
