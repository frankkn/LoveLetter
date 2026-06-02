import { t } from '../i18n.js';
import { escapeHTML } from '../utils.js';
import type { Player } from '../domain/game-state.js';

// 玩家標題列的展示用 HTML：硬幣圖示與含硬幣/出局狀態的玩家名稱。純函式。

/** 單枚聯賽硬幣的 inline SVG */
export function coinIconHTML(): string {
    return `<svg class="coin-icon" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:1em;height:1em;display:inline-block;vertical-align:-0.12em;flex:0 0 auto;"><circle cx="12" cy="12" r="10" fill="#f6c85f" stroke="#9b6b13" stroke-width="1.8"></circle><circle cx="12" cy="12" r="6.7" fill="#ffd978" stroke="#c58a1d" stroke-width="1.2"></circle><path d="M8.6 12.9h6.8M9.6 9.6h4.8M9.6 16.1h4.8" stroke="#8b5a0a" stroke-width="1.6" stroke-linecap="round"></path></svg>`;
}

/** 將硬幣數渲染成一排硬幣圖示（0 枚回傳空字串） */
export function getCoinIcons(coins: number): string {
    return coins > 0
        ? `<span class="coin-icons" aria-label="${t('coins.label', String(coins))}" style="display:inline-flex;align-items:center;gap:0.12em;line-height:1;vertical-align:-0.12em;">${coinIconHTML().repeat(coins)}</span>`
        : '';
}

/** 玩家名稱 + 硬幣 + 出局狀態徽章；suffix 可附加（例如「（你）」） */
export function getPlayerTitleHTML(player: Player, suffix = ''): string {
    const statusBadge = player.isAlive ? '' : `<span class="player-status-badge">${t('game.eliminated')}</span>`;
    const title = `${escapeHTML(player.name)}${suffix ? ` ${escapeHTML(suffix)}` : ''}`;
    return `<span class="player-title-name">${title}</span>${getCoinIcons(player.coins)}${statusBadge}`;
}
