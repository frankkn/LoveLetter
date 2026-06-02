import { CardType, CARD_DEFINITIONS, type Card } from '../domain/cards.js';
import type { GameState, Player } from '../domain/game-state.js';
import { t, getCardName } from '../i18n.js';

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
        `<button class="target-btn" data-id="${target.id}">${target.name}</button>`
    )).join('');

    return `
        <p class="modal-helper-text">${hint}</p>
        ${createPlayedCardStatsHTML(state)}
        <div class="target-list">${buttonsHTML}</div>
    `;
}
