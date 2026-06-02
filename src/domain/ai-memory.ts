import { CardType, type Card } from './cards.js';
import type { BaronGuardClue, GameState, Player } from './game-state.js';

// 電腦玩家的記憶系統：記住對手手牌（神父/國王/男爵得知）與失敗的衛兵猜測，
// 全部以 GameState.aiMemory / aiExcludedGuesses 為儲存體，函式皆傳入 state 操作。

export function createAIMemory(players: Player[]): Record<number, Record<number, CardType>> {
    return players
        .filter(player => player.isBot)
        .reduce<Record<number, Record<number, CardType>>>((memory, bot) => {
            memory[bot.id] = {};
            return memory;
        }, {});
}

export function createAIExcludedGuesses(players: Player[]): Record<number, Record<number, CardType[]>> {
    return players
        .filter(player => player.isBot)
        .reduce<Record<number, Record<number, CardType[]>>>((exclusions, bot) => {
            exclusions[bot.id] = {};
            return exclusions;
        }, {});
}

export function rememberKnownCard(state: GameState, observerId: number, targetId: number, cardType: CardType) {
    const observer = state.players[observerId];
    if (!observer?.isBot) return;
    if (observer.difficulty === 'easy') return; // Easy bots have no memory
    state.aiMemory[observerId] ??= {};
    state.aiMemory[observerId][targetId] = cardType;
}

/** 男爵/衛兵線索是否有用：對手出局的牌介於侍女~伯爵夫人之間才值得記憶 */
export function isUsefulBaronGuardClue(loserCardType: CardType) {
    return loserCardType >= CardType.Handmaid && loserCardType <= CardType.Countess;
}

export function rememberGuardMiss(state: GameState, targetId: number, guessedType: CardType) {
    if (guessedType === CardType.Guard) return;

    state.players
        .filter(player => player.isBot)
        .forEach(bot => {
            state.aiExcludedGuesses[bot.id] ??= {};
            const excludedTypes = state.aiExcludedGuesses[bot.id][targetId] ?? [];
            if (!excludedTypes.includes(guessedType)) {
                state.aiExcludedGuesses[bot.id][targetId] = [...excludedTypes, guessedType];
            }
        });
}

export function clearExcludedGuardGuessesForPlayer(state: GameState, playerId: number) {
    Object.values(state.aiExcludedGuesses).forEach(exclusions => {
        delete exclusions[playerId];
    });
}

export function pruneInvalidKnownCardsForPlayer(state: GameState, playerId: number) {
    const player = state.players[playerId];
    Object.values(state.aiMemory).forEach(memory => {
        const rememberedType = memory[playerId];
        if (rememberedType && !player.hand.some(card => card.type === rememberedType)) {
            delete memory[playerId];
        }
    });
}

export function getKnownGuardTarget(state: GameState, botId: number, potentialTargets: Player[]): Player | null {
    const memory = state.aiMemory[botId];
    if (!memory) return null;

    const potentialTargetIds = new Set(potentialTargets.map(target => target.id));
    for (const [targetIdText, rememberedType] of Object.entries(memory)) {
        const targetId = Number(targetIdText);
        const target = state.players[targetId];
        const targetStillHasRememberedCard = target?.hand.some(card => card.type === rememberedType);

        if (!target?.isAlive || !targetStillHasRememberedCard) {
            delete memory[targetId];
            continue;
        }

        if (rememberedType !== CardType.Guard && potentialTargetIds.has(targetId)) {
            return target;
        }
    }

    return null;
}

export function getRememberedCardType(state: GameState, observerId: number, targetId: number): CardType | null {
    const rememberedType = state.aiMemory[observerId]?.[targetId];
    const target = state.players[targetId];
    if (!rememberedType || !target?.hand.some(card => card.type === rememberedType)) {
        if (state.aiMemory[observerId]) delete state.aiMemory[observerId][targetId];
        return null;
    }

    return rememberedType;
}

export function getExcludedGuardGuesses(state: GameState, observerId: number, targetId: number): Set<CardType> {
    const excludedTypes = state.aiExcludedGuesses[observerId]?.[targetId] ?? [];
    return new Set(excludedTypes.filter(type => type !== CardType.Guard));
}

export function getBaronLegalTargets(state: GameState, bot: Player): Player[] {
    return state.players.filter(player => (
        player.id !== bot.id &&
        player.isAlive &&
        !player.isProtected
    ));
}

export function getBaronRemainingCard(bot: Player, baron: Card): Card | null {
    return bot.hand.find(card => card.id !== baron.id) ?? null;
}

export function isKnownBaronLoss(state: GameState, bot: Player, baron: Card, target: Player): boolean {
    const remainingCard = getBaronRemainingCard(bot, baron);
    const rememberedType = getRememberedCardType(state, bot.id, target.id);
    return Boolean(remainingCard && rememberedType && rememberedType > remainingCard.value);
}

export function getSafeBaronTargets(state: GameState, bot: Player, baron: Card, targets: Player[]): Player[] {
    return targets.filter(target => !isKnownBaronLoss(state, bot, baron, target));
}

// ── 男爵/衛兵線索 ────────────────────────────────────────────────────────────
// 當男爵對決結束，敗者的牌型（若值得記憶）會被存成一條線索；困難 AI 用它推測
// 對手手牌、提高衛兵猜中率並優先攻擊該玩家。線索為跨函式的單一可變狀態，
// 由 get/set 存取器供存檔/同步/生命週期等非 AI 程式碼讀寫。
let recentBaronGuardClue: BaronGuardClue | null = null;

export function getRecentBaronGuardClue(): BaronGuardClue | null {
    return recentBaronGuardClue;
}

export function setRecentBaronGuardClue(clue: BaronGuardClue | null): void {
    recentBaronGuardClue = clue;
}

export function rememberBaronGuardClue(winnerId: number, loserId: number, loserCardType: CardType, sourceCardId: string) {
    if (!isUsefulBaronGuardClue(loserCardType)) {
        recentBaronGuardClue = null;
        return;
    }

    recentBaronGuardClue = {
        winnerId,
        loserId,
        loserCardType,
        sourceCardId
    };
}

export function clearBaronGuardClueForPlayer(playerId: number) {
    if (recentBaronGuardClue?.winnerId === playerId) {
        recentBaronGuardClue = null;
    }
}

export function getActiveBaronGuardClue(state: GameState, botId: number, targetId?: number): BaronGuardClue | null {
    const clue = recentBaronGuardClue;
    if (!clue || clue.winnerId === botId) return null;
    if (targetId !== undefined && clue.winnerId !== targetId) return null;

    const winner = state.players[clue.winnerId];
    if (!winner?.isAlive || winner.isProtected || winner.hand.length === 0) {
        recentBaronGuardClue = null;
        return null;
    }

    return clue;
}

export function getBaronGuardClueTarget(state: GameState, botId: number, potentialTargets: Player[]): Player | null {
    const clue = getActiveBaronGuardClue(state, botId);
    if (!clue) return null;

    return potentialTargets.find(target => target.id === clue.winnerId) ?? null;
}

export function clearKnownCardForPlayer(state: GameState, playerId: number) {
    Object.values(state.aiMemory).forEach(memory => {
        delete memory[playerId];
    });
    if (state.players[playerId]) {
        state.players[playerId].handKnownToOpponent = false;
    }
    clearBaronGuardClueForPlayer(playerId);
    clearExcludedGuardGuessesForPlayer(state, playerId);
}
