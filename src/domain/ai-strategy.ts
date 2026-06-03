import { CardType, CARD_DEFINITIONS, type Card } from './cards.js';
import type { GameState, Player } from './game-state.js';
import {
    getExcludedGuardGuesses,
    getActiveBaronGuardClue,
    getBaronGuardClueTarget,
    getBaronLegalTargets,
    getSafeBaronTargets,
    getRememberedCardType,
    getKnownGuardTarget,
} from './ai-memory.js';

// 電腦玩家的出牌/猜牌策略。難度分 easy / medium / hard：
// easy 近乎隨機（僅避開公主），medium/hard 會運用 ai-memory 的記憶與線索。
// 所有函式以參數傳入 GameState，不依賴模組外全域變數。

/** Weighted random pick over {value, weight} entries. Caller guarantees a non-empty list. */
function pickWeightedValue(entries: { value: number; weight: number }[]): number {
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const entry of entries) {
        roll -= entry.weight;
        if (roll <= 0) return entry.value;
    }
    return entries[entries.length - 1].value;
}

/** Hard: when no specific target is found, weight candidates by coin count to pressure leaders. */
export function chooseMetaAwareTarget(candidates: Player[]): Player | null {
    if (candidates.length === 0) return null;
    const maxCoins = Math.max(...candidates.map(p => p.coins));
    if (maxCoins === 0) return null; // no leader yet — let the caller fall through to random
    let roll = Math.random() * candidates.reduce((sum, p) => sum + p.coins + 1, 0);
    for (const p of candidates) {
        roll -= p.coins + 1;
        if (roll <= 0) return p;
    }
    return candidates[candidates.length - 1];
}

// Estimate a Baron "safety" score for attacking targetId with a card of botCardValue,
// using the remaining-card distribution. Win = 1, tie = 0.5 (safe, no elimination),
// loss = 0. Returns the certain value when the target's card is known.
export function estimateBaronWinProbability(state: GameState, botId: number, targetId: number, botCardValue: number): number {
    const known = getRememberedCardType(state, botId, targetId);
    if (known !== null) {
        if (known < botCardValue) return 1;
        if (known === botCardValue) return 0.5; // tie is safe but eliminates no one
        return 0;
    }

    // Cards accounted for: all discards + bot's own hand
    const accountedCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
    state.players.forEach(p => p.discardPile.forEach(c => accountedCounts[c.value]++));
    state.players[botId].hand.forEach(c => accountedCounts[c.value]++);

    let unknownTotal = 0;
    let unknownBelow = 0;
    let unknownEqual = 0;
    for (let i = 1; i <= 8; i++) {
        const remaining = CARD_DEFINITIONS[i as CardType].count - accountedCounts[i];
        if (remaining > 0) {
            unknownTotal += remaining;
            if (i < botCardValue) unknownBelow += remaining;
            else if (i === botCardValue) unknownEqual += remaining;
        }
    }
    return unknownTotal > 0 ? (unknownBelow + 0.5 * unknownEqual) / unknownTotal : 0;
}

/** Hard: pick the safe Baron target we're most likely to beat. */
export function getBestBaronTarget(state: GameState, botId: number, candidates: Player[]): Player | null {
    const remaining = state.players[botId].hand[0]; // remaining card after Baron moved to discard
    if (!remaining || candidates.length === 0) return null;
    let best = candidates[0];
    let bestProb = -1;
    for (const candidate of candidates) {
        const prob = estimateBaronWinProbability(state, botId, candidate.id, remaining.value);
        if (prob > bestProb) {
            bestProb = prob;
            best = candidate;
        }
    }
    return best;
}

/** True if at least one Guard is unaccounted for (could be in a hand or burned). */
export function guardsStillInPlay(state: GameState): boolean {
    let seen = 0;
    state.players.forEach(p => p.discardPile.forEach(c => {
        if (c.type === CardType.Guard) seen++;
    }));
    return seen < CARD_DEFINITIONS[CardType.Guard].count;
}

/** Medium/Hard: an opponent we remember is holding the Princess — Prince forces an instant KO. */
export function getKnownPrincessTarget(state: GameState, botId: number, candidates: Player[]): Player | null {
    return candidates.find(candidate => (
        candidate.id !== botId &&
        getRememberedCardType(state, botId, candidate.id) === CardType.Princess
    )) ?? null;
}

/** 衛兵猜測：依記憶、剩餘牌張數與男爵線索挑一個牌型值（2~8） */
export function getAISmartGuess(state: GameState, botId: number, targetId: number): number {
    const difficulty = state.players[botId]?.difficulty ?? 'hard';

    // Medium/Hard: use memory to guess the known card directly
    if (difficulty !== 'easy') {
        const rememberedType = state.aiMemory[botId]?.[targetId];
        if (rememberedType) {
            const targetStillHasRememberedCard = state.players[targetId].hand.some(card => card.type === rememberedType);
            if (!targetStillHasRememberedCard) {
                delete state.aiMemory[botId][targetId];
            } else if (rememberedType !== CardType.Guard) {
                return rememberedType;
            }
        }
    }

    // All difficulties: count remaining cards from discards + own hand
    const knownCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
    state.players.forEach(p => {
        p.discardPile.forEach(c => knownCounts[c.value]++);
    });
    state.players[botId].hand.forEach(c => knownCounts[c.value]++);

    // Medium/Hard: avoid repeating failed guesses
    const excludedGuesses = difficulty !== 'easy' ? getExcludedGuardGuesses(state, botId, targetId) : new Set<CardType>();

    // Hard only: use baron clue to narrow the range
    if (difficulty === 'hard') {
        const baronClue = getActiveBaronGuardClue(state, botId, targetId);
        if (baronClue) {
            const inferredGuesses: { value: number; weight: number }[] = [];
            for (let i = Math.max(CardType.Priest, baronClue.loserCardType + 1); i <= CardType.Princess; i++) {
                const remaining = CARD_DEFINITIONS[i as CardType].count - knownCounts[i];
                if (!excludedGuesses.has(i as CardType) && remaining > 0) {
                    // Weight by remaining copies, consistent with the general guess below
                    inferredGuesses.push({ value: i, weight: remaining });
                }
            }
            if (inferredGuesses.length > 0) {
                return pickWeightedValue(inferredGuesses);
            }
        }
    }

    const possibleGuesses: { value: number; weight: number }[] = [];
    for (let i = 2; i <= 8; i++) {
        const remaining = CARD_DEFINITIONS[i as CardType].count - knownCounts[i];
        if (!excludedGuesses.has(i as CardType) && remaining > 0) {
            // Medium/Hard: weight by remaining copies so rarer cards are guessed less often
            possibleGuesses.push({ value: i, weight: difficulty !== 'easy' ? remaining : 1 });
        }
    }
    if (possibleGuesses.length > 0) {
        return pickWeightedValue(possibleGuesses);
    }

    const fallbackGuesses: number[] = [];
    for (let i = 2; i <= 8; i++) {
        if (!excludedGuesses.has(i as CardType)) {
            fallbackGuesses.push(i);
        }
    }
    return fallbackGuesses.length > 0 ? fallbackGuesses[Math.floor(Math.random() * fallbackGuesses.length)] : 2;
}

/** 單張牌的出牌權重（加權隨機選牌用） */
export function getAICardPlayWeight(state: GameState, bot: Player, card: Card): number {
    const difficulty = bot.difficulty ?? 'hard';
    // Easy: flat random weights (still respect Princess avoidance)
    if (difficulty === 'easy') {
        return card.type === CardType.Princess ? 0.1 : 10;
    }

    const remainingCard = bot.hand.find(handCard => handCard.id !== card.id);
    let weight = 10;

    switch (card.type) {
        case CardType.Guard:
            weight = 28;
            // Hard only: extra boost when baron clue gives a strong lead
            if (difficulty === 'hard' && getBaronGuardClueTarget(state, bot.id, state.players.filter(player => (
                player.id !== bot.id &&
                player.isAlive &&
                !player.isProtected
            )))) {
                weight = 42;
            }
            break;
        case CardType.Priest:
            weight = 12;
            break;
        case CardType.Baron:
            weight = 8;
            if (remainingCard) {
                const legalTargets = getBaronLegalTargets(state, bot);
                // Medium/Hard: discard known-loss matchups; we can still target someone else
                const safeTargets = getSafeBaronTargets(state, bot, card, legalTargets);
                if (safeTargets.length === 0) {
                    // Every legal opponent beats us (or there are none) — don't play Baron
                    weight = 0;
                    break;
                }
                if (difficulty === 'hard') {
                    // Hard: weight by our best matchup, since we'll target the safest opponent
                    const bestWinProb = Math.max(
                        ...safeTargets.map(t => estimateBaronWinProbability(state, bot.id, t.id, remainingCard.value))
                    );
                    weight = Math.max(0.1, bestWinProb * 20);
                } else {
                    // Medium: simple card-value thresholds
                    if (remainingCard.value <= CardType.Guard) weight = 0.1;
                    else if (remainingCard.value <= CardType.Priest) weight = 2;
                    else if (remainingCard.value >= CardType.Prince) weight = 15;
                }
            }
            break;
        case CardType.Handmaid:
            weight = 9;
            if (difficulty === 'hard' && remainingCard) {
                // Boost when holding a high-value card (attractive target) or hand is exposed
                if (remainingCard.value >= CardType.Princess) weight = 24;
                else if (remainingCard.value >= CardType.Countess) weight = 18;
                else if (remainingCard.value >= CardType.King) weight = 16;
                else if (bot.handKnownToOpponent) weight = 16;
            }
            break;
        case CardType.Prince:
            weight = 10;
            // Medium/Hard (easy already returned): forcing a remembered Princess holder
            // to discard is a guaranteed KO
            {
                const princeTargets = state.players.filter(p => p.id !== bot.id && p.isAlive && !p.isProtected);
                if (getKnownPrincessTarget(state, bot.id, princeTargets)) weight = 40;
            }
            break;
        case CardType.King:
            weight = 7;
            break;
        case CardType.Countess:
            weight = 3;
            break;
        case CardType.Princess:
            weight = 0.1;
            break;
    }

    return weight;
}

/** 依權重（含特殊優先規則）挑一張要打出的牌 */
export function chooseAICardToPlay(state: GameState, bot: Player): Card {
    const difficulty = bot.difficulty ?? 'hard';

    // Medium/Hard: if we know an opponent's card, prioritise guard immediately
    if (difficulty !== 'easy') {
        const guard = bot.hand.find(card => card.type === CardType.Guard);
        if (guard) {
            const guardTargets = state.players.filter(player => (
                player.id !== bot.id &&
                player.isAlive &&
                !player.isProtected
            ));
            if (getKnownGuardTarget(state, bot.id, guardTargets)) return guard;
        }

        const baron = bot.hand.find(card => card.type === CardType.Baron);
        if (guard && baron) return guard;
    }

    let playable = bot.hand.filter(card => card.type !== CardType.Princess);
    if (playable.length === 0) playable = bot.hand;

    const weightedCards = playable.map(card => ({
        card,
        weight: Math.max(0, getAICardPlayWeight(state, bot, card))
    }));
    let totalWeight = weightedCards.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) {
        weightedCards.forEach(item => {
            item.weight = 1;
        });
        totalWeight = weightedCards.length;
    }
    let roll = Math.random() * totalWeight;

    for (const item of weightedCards) {
        roll -= item.weight;
        if (roll <= 0) return item.card;
    }

    return weightedCards[weightedCards.length - 1].card;
}
