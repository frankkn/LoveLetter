import { CARD_IMAGES, type Card } from '../domain/cards.js';
import { t, getCardName, getCardDesc } from '../i18n.js';
import { escapeHTML } from '../utils.js';

// 單張卡牌的 DOM 呈現（手牌 / 棄牌 / modal 內翻牌）。
// 私密提示是否顯示取決於觀看者，故 localPlayerId 以參數傳入而非依賴全域。

export function createCardUI(card: Card, isPlayable: boolean, localPlayerId: number): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-wrapper';
    if (!isPlayable) wrapper.style.cursor = 'default';

    const visiblePrivateHints = card.privateHintOwnerId === localPlayerId
        ? card.privateActionHints
        : undefined;
    const actionHints = visiblePrivateHints ?? card.actionHints ?? (card.targetName && card.guessedCardName
        ? [{ text: t('hint.guardGuess', card.targetName!, card.guessedCardName!) }]
        : []);

    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.innerHTML = `
        <div class="card-header">
            <span class="card-name">${getCardName(card.type)}</span>
            <div class="card-value">${card.value}</div>
        </div>
        <div class="card-img">
            <img src="${CARD_IMAGES[card.type]}" alt="${getCardName(card.type)}" loading="lazy">
        </div>
        <div class="card-desc">${getCardDesc(card.type)}</div>
    `;
    cardDiv.addEventListener('pointerenter', () => {
        wrapper.classList.add('card-wrapper-hovering');
        wrapper.closest('.area')?.classList.add('card-area-hovering');
        positionCardDescription(cardDiv);
    });
    cardDiv.addEventListener('pointerleave', () => {
        wrapper.classList.remove('card-wrapper-hovering');
        wrapper.closest('.area')?.classList.remove('card-area-hovering');
        cardDiv.classList.remove('card-desc-below');
        cardDiv.style.removeProperty('--card-desc-shift');
    });
    wrapper.appendChild(cardDiv);

    if (actionHints.length > 0) {
        const hintsDiv = document.createElement('div');
        hintsDiv.className = 'card-action-hints';
        // hint.text and hint.variant can originate from a synced (and therefore
        // attacker-controllable) card, so escape the text and whitelist the
        // variant before injecting as HTML — otherwise a forged hint is stored XSS.
        const allowedVariants = ['default', 'danger', 'tie'];
        hintsDiv.innerHTML = actionHints.map(hint => {
            const variantClass = hint.variant && allowedVariants.includes(hint.variant)
                ? ` card-action-hint-${hint.variant}`
                : '';
            return `
            <div class="card-action-hint${variantClass}">
                ${escapeHTML(hint.text)}
            </div>
        `;
        }).join('');
        wrapper.appendChild(hintsDiv);
    }

    if (!isPlayable) {
        cardDiv.style.cursor = 'default';
    }
    return wrapper;
}

/** 動態調整卡牌說明 tooltip 位置，避免超出視窗邊緣 */
export function positionCardDescription(cardEl: HTMLElement) {
    const desc = cardEl.querySelector<HTMLElement>('.card-desc');
    if (!desc) return;

    cardEl.classList.remove('card-desc-below');
    cardEl.style.setProperty('--card-desc-shift', '0px');

    window.requestAnimationFrame(() => {
        const margin = 8;
        let rect = desc.getBoundingClientRect();

        if (rect.top < margin) {
            cardEl.classList.add('card-desc-below');
            rect = desc.getBoundingClientRect();
        }

        let shift = 0;
        if (rect.left < margin) {
            shift = margin - rect.left;
        } else if (rect.right > window.innerWidth - margin) {
            shift = window.innerWidth - margin - rect.right;
        }
        cardEl.style.setProperty('--card-desc-shift', `${shift}px`);
    });
}
