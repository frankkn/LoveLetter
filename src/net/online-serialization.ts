import { CardType, CARD_DEFINITIONS, type Card } from '../domain/cards.js';
import type { Player } from '../domain/game-state.js';
import type { PendingForcedEffect, PendingBaronDuel, PendingKingExchange } from '../domain/online-types.js';

// 線上同步用的純序列化 / 深拷貝工具：把本地物件轉成可安全廣播的形狀
// （剝除私密提示、隱藏機器人手牌），以及待處理效果的深拷貝。皆為純函式。

/** 複製一張牌供廣播：移除私密提示欄位，只保留公開資訊 */
export function cloneCardForOnlineSync(card: Card): Card {
    const { privateActionHints, privateHintOwnerId, actionHints, ...publicCard } = card;
    void privateActionHints;
    void privateHintOwnerId;
    return {
        ...publicCard,
        ...(actionHints ? { actionHints: actionHints.map(hint => ({ ...hint })) } : {})
    };
}

// Produce a face-down placeholder for a bot's hand card.
// Non-host clients never need the actual card type during play — bots are
// always rendered as "?" until the round ends. Sending real types would leak
// bot hands to anyone with browser dev-tools open.
export function hiddenBotCard(card: Card): Card {
    return { id: card.id, type: 0 as CardType, name: '', value: 0, description: '' };
}

export function cloneOnlinePlayer(player: Player): Player {
    return {
        ...player,
        hand: player.hand.map(cloneCardForOnlineSync),
        discardPile: player.discardPile.map(cloneCardForOnlineSync)
        // isBot is intentionally preserved so all clients can identify bot players for
        // turn-logic routing (queueBotTurn is host-guarded and safe for non-host clients).
    };
}

/** 是否為被隱藏的牌（type 0 或非法牌型）——用於辨識機器人遮蔽手牌 */
export function isHiddenOnlineCard(card: Card): boolean {
    const type = Number(card.type);
    return type === 0 || !(type in CARD_DEFINITIONS);
}

export function clonePendingForcedEffect(effect: PendingForcedEffect): PendingForcedEffect {
    return {
        ...effect,
        sourcePlayerId: effect.sourcePlayerId ?? effect.returnTurnPlayerId,
        card: { ...effect.card }
    };
}

export function clonePendingForcedEffectsQueue(queue: PendingForcedEffect[] | undefined, fallback?: PendingForcedEffect | null) {
    if (queue) {
        return queue.map(clonePendingForcedEffect);
    }

    return fallback ? [clonePendingForcedEffect(fallback)] : [];
}

export function clonePendingBaronDuel(duel: PendingBaronDuel): PendingBaronDuel {
    return {
        ...duel,
        actorCard: { ...duel.actorCard },
        targetCard: { ...duel.targetCard },
        confirmedPlayerIds: [...duel.confirmedPlayerIds]
    };
}

export function clonePendingKingExchange(exchange: PendingKingExchange): PendingKingExchange {
    return {
        ...exchange,
        confirmedPlayerIds: [...exchange.confirmedPlayerIds]
    };
}
