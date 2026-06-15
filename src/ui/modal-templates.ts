import { CardType, CARD_DEFINITIONS, type Card } from '../domain/cards.js';
import type { GameState, Player } from '../domain/game-state.js';
import { t, getCardName } from '../i18n.js';
import { escapeHTML } from '../utils.js';
import { createCardUI } from './card-render.js';
import type { PendingBaronDuel, PendingForcedEffect } from '../domain/online-types.js';

// Modal 內共用的 HTML body 片段（出牌統計面板、統計版型、選擇目標版型）。
// 讀取遊戲狀態的部分以參數傳入 state，不依賴模組外的全域變數。

/** 已打出牌張的統計面板（依牌型列出 已出/總數） */
export function createPlayedCardStatsHTML(state: GameState): string {
    const counts = new Map<CardType, number>();
    state.players
        .flatMap(player => player.discardPile)
        .forEach(card => counts.set(card.type, (counts.get(card.type) || 0) + 1));

    const rows = Array.from({ length: CardType.Princess }, (_, index) => {
        const type = (index + 1) as CardType;
        const count = counts.get(type) || 0;
        const def = CARD_DEFINITIONS[type];
        return `
            <div class="modal-card-stat-row ${count === 0 ? 'empty' : ''}">
                <span class="modal-card-stat-value">${type}</span>
                <span class="modal-card-stat-name">${getCardName(type)}</span>
                <span class="modal-card-stat-count">${count}/${def.count}</span>
            </div>
        `;
    }).join('');

    return `
        <section class="modal-card-stats" aria-label="${t('game.stats')}">
            <h3>${t('game.stats')}</h3>
            <div class="modal-card-stats-grid">${rows}</div>
        </section>
    `;
}

/** 在任意 body 內容下方附加出牌統計面板 */
export function createStatsModalBodyHTML(state: GameState, bodyHTML: string): string {
    return `
        ${bodyHTML}
        ${createPlayedCardStatsHTML(state)}
    `;
}

/** 選擇目標的 modal body：提示文字 + 出牌統計 + 目標按鈕列 */
export function createTargetSelectModalBodyHTML(state: GameState, card: Card, targets: Player[]): string {
    const hintKeyByType: Partial<Record<CardType, string>> = {
        [CardType.Guard]:   'target.hint.guard',
        [CardType.Priest]:  'target.hint.priest',
        [CardType.Baron]:   'target.hint.baron',
        [CardType.Prince]:  'target.hint.prince',
        [CardType.King]:    'target.hint.king',
    };
    const hintKey = hintKeyByType[card.type];
    const hint = hintKey ? t(hintKey) : t('target.hint.default', getCardName(card.type));
    const buttonsHTML = targets.map(target => (
        `<button class="target-btn" data-id="${target.id}">${escapeHTML(target.name)}</button>`
    )).join('');

    return `
        <p class="modal-helper-text">${hint}</p>
        ${createPlayedCardStatsHTML(state)}
        <div class="target-list">${buttonsHTML}</div>
    `;
}

/** 雙方翻牌對照（男爵對決 / 國王交換）的 modal body */
export function createHandRevealBodyHTML(
    message: string,
    actorName: string,
    actorCard: Card,
    targetName: string,
    targetCard: Card,
    localPlayerId: number,
): string {
    return `
        <p>${message}</p>
        <div class="duel-card-row">
            <div class="duel-card-column">
                <strong>${escapeHTML(actorName)}</strong>
                ${createCardUI(actorCard, false, localPlayerId).outerHTML}
            </div>
            <div class="duel-card-column">
                <strong>${escapeHTML(targetName)}</strong>
                ${createCardUI(targetCard, false, localPlayerId).outerHTML}
            </div>
        </div>
    `;
}

/** 牌堆耗盡時的比牌結算 modal body */
export function createDeckShowdownBodyHTML(sorted: Player[], winner: Player, localPlayerId: number): string {
    // Highlight every player tied for the top (same hand value AND discard total),
    // so a shared-win tie is shown clearly instead of crowning one arbitrarily.
    const handValue = (p: Player) => p.hand[0]?.value ?? -1;
    const discardSum = (p: Player) => p.discardPile.reduce((s, c) => s + c.value, 0);
    const isWinningPlayer = (p: Player) =>
        handValue(p) === handValue(winner) && discardSum(p) === discardSum(winner);
    const columns = sorted.map(p => {
        const isWinner = isWinningPlayer(p);
        const cardEl = p.hand[0] ? createCardUI(p.hand[0], false, localPlayerId).outerHTML : '';
        return `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0.35rem;
                        padding:0.5rem 0.65rem;border-radius:8px;
                        border:2px solid ${isWinner ? '#ffb000' : 'rgba(255,255,255,0.15)'};
                        background:${isWinner ? 'rgba(255,176,0,0.1)' : 'rgba(255,255,255,0.04)'};">
                <strong style="color:${isWinner ? '#ffb000' : '#f2f2f2'};font-size:0.95rem;">
                    ${escapeHTML(p.name)}
                </strong>
                ${cardEl}
                ${isWinner ? `<span style="color:#ffb000;font-weight:bold;font-size:0.85rem;">${t('deckShowdown.winner')}</span>` : ''}
            </div>`;
    }).join('');
    return `
        <p style="margin:0 0 0.75rem;">${t('deckShowdown.intro')}</p>
        <div class="duel-card-row" style="flex-wrap:wrap;">
            ${columns}
        </div>`;
}

/** 男爵對決雙方翻牌的 modal body */
export function createBaronDuelBodyHTML(state: GameState, duel: PendingBaronDuel, localPlayerId: number): string {
    const actor = state.players[duel.actorId];
    const target = state.players[duel.targetId];

    return createHandRevealBodyHTML(
        t('baron.reveal', actor.name, target.name),
        actor.name,
        duel.actorCard,
        target.name,
        duel.targetCard,
        localPlayerId
    );
}

/** 通知被王子強制棄牌的玩家其手牌即將觸發效果的 modal body */
export function createForcedEffectNoticeBodyHTML(state: GameState, effect: PendingForcedEffect, localPlayerId: number): string {
    const attacker = state.players[effect.sourcePlayerId] ?? state.players[state.currentTurnPlayerId];
    const attackerName = attacker?.name ?? t('player.opponent');
    const cardUI = createCardUI(effect.card, false, localPlayerId);
    cardUI.style.margin = '0.5rem auto 0';

    return `
        <p>${t('forced.body1', attackerName)}</p>
        <p>${t('forced.body2', getCardName(effect.card.type))}</p>
        ${cardUI.outerHTML}
        <p style="margin-top:0.5rem">${t('forced.body3')}</p>
    `;
}
