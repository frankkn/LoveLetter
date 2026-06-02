import { CardType, CARD_DEFINITIONS, type Card } from './cards.js';
import type { GameState, Player } from './game-state.js';
import {
    getExcludedGuardGuesses,
    getActiveBaronGuardClue,
    getBaronGuardClueTarget,
    getBaronLegalTargets,
    isKnownBaronLoss,
    getKnownGuardTarget,
} from './ai-memory.js';

// 電腦玩家的出牌/猜牌策略。難度分 easy / medium / hard：
// easy 近乎隨機（僅避開公主），medium/hard 會運用 ai-memory 的記憶與線索。
// 所有函式以參數傳入 GameState，不依賴模組外全域變數。

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
            const inferredGuesses: number[] = [];
            for (let i = Math.max(CardType.Priest, baronClue.loserCardType + 1); i <= CardType.Princess; i++) {
                if (!excludedGuesses.has(i as CardType) && knownCounts[i] < CARD_DEFINITIONS[i as CardType].count) {
                    inferredGuesses.push(i);
                }
            }
            if (inferredGuesses.length > 0) {
                return inferredGuesses[Math.floor(Math.random() * inferredGuesses.length)];
            }
        }
    }

    const possibleGuesses: number[] = [];
    for (let i = 2; i <= 8; i++) {
        if (!excludedGuesses.has(i as CardType) && knownCounts[i] < CARD_DEFINITIONS[i as CardType].count) {
            possibleGuesses.push(i);
        }
    }
    if (possibleGuesses.length > 0) {
        return possibleGuesses[Math.floor(Math.random() * possibleGuesses.length)];
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
                // Medium/Hard: avoid known losing matchups
                if (legalTargets.some(target => isKnownBaronLoss(state, bot, card, target))) {
                    weight = 0;
                    break;
                }
                if (remainingCard.value <= CardType.Guard) weight = 0.1;
                else if (remainingCard.value <= CardType.Priest) weight = 2;
                else if (remainingCard.value >= CardType.Prince) weight = 15;
            }
            break;
        case CardType.Handmaid:
            weight = 9;
            break;
        case CardType.Prince:
            weight = 10;
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
