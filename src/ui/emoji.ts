interface EmojiRoom {
    send(type: string, message: unknown): void;
}

interface EmojiControllerOptions {
    getRoom: () => EmojiRoom | null;
    getLocalPlayerId: () => number;
    getLocalPlayerHandEl: () => HTMLElement;
}

export interface EmojiController {
    bindEvents(): void;
    showFloatingEmoji(emoji: string, playerId: number): void;
}

export function createEmojiController(options: EmojiControllerOptions): EmojiController {
    const overlayEl = document.getElementById('emoji-wheel-overlay') as HTMLElement;
    const buttonEl = document.getElementById('emoji-btn') as HTMLButtonElement;
    const backdropEl = document.getElementById('emoji-wheel-backdrop')!;
    const wheelEl = document.getElementById('emoji-wheel-svg')!;
    let cooldownUntil = 0;

    function openEmojiWheel() {
        if (Date.now() < cooldownUntil) return;
        overlayEl.style.display = 'flex';
    }

    function closeEmojiWheel() {
        overlayEl.style.display = 'none';
    }

    function sendEmoji(emoji: string) {
        closeEmojiWheel();
        const room = options.getRoom();
        if (!room) return;
        // playerId 由伺服器依發送者 session 推導，payload 不再攜帶（防冒充）。
        room.send('emoji_react', { emoji });
        cooldownUntil = Date.now() + 3000;
        buttonEl.disabled = true;
        setTimeout(() => { buttonEl.disabled = false; }, 3000);
    }

    function showFloatingEmoji(emoji: string, playerId: number) {
        let targetEl: HTMLElement | null;
        if (playerId === options.getLocalPlayerId()) {
            targetEl = options.getLocalPlayerHandEl();
        } else {
            targetEl = document.querySelector<HTMLElement>(
                `.opponent-area[data-player-id="${playerId}"] .hand-container`
            );
        }
        if (!targetEl) return;

        const rect = targetEl.getBoundingClientRect();
        const div = document.createElement('div');
        div.className = 'floating-emoji';
        div.textContent = emoji;
        div.style.left = `${rect.left + rect.width / 2 - 40}px`;
        div.style.top  = `${rect.top  + rect.height / 2 - 56}px`;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 2000);
    }

    function bindEvents() {
        buttonEl.onclick = () => {
            if (overlayEl.style.display !== 'none') {
                closeEmojiWheel();
            } else {
                openEmojiWheel();
            }
        };

        backdropEl.onclick = closeEmojiWheel;

        wheelEl.addEventListener('click', e => {
            const sector = (e.target as SVGElement).closest<SVGPathElement>('.emoji-sector');
            if (sector?.dataset.emoji) sendEmoji(sector.dataset.emoji);
        });
    }

    return { bindEvents, showFloatingEmoji };
}
