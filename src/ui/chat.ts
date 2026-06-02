export interface ChatMsg {
    sessionId: string;
    name: string;
    text: string;
    timestamp: number;
}

interface ChatRoom {
    send(type: string, message: unknown): void;
}

interface ChatControllerOptions {
    getRoom: () => ChatRoom | null;
}

export interface ChatController {
    bindEvents(): void;
    /** 收到一則新訊息（來自 server 廣播） */
    addMessage(msg: ChatMsg): void;
    /** 清空聊天記錄（例如新一局開始） */
    clearMessages(): void;
}

export function createChatController(options: ChatControllerOptions): ChatController {
    const panelEl = document.getElementById('chat-panel')!;
    const backdropEl = document.getElementById('chat-backdrop')!;
    const messagesEl = document.getElementById('chat-messages')!;
    const inputEl = document.getElementById('chat-input') as HTMLInputElement;
    const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
    const unreadBadgeEl = document.getElementById('chat-unread-badge')!;

    let messages: ChatMsg[] = [];
    let unreadCount = 0;
    let isOpen = false;

    function setOpen(open: boolean) {
        isOpen = open;
        panelEl.classList.toggle('open', open);
        backdropEl.classList.toggle('open', open);
        panelEl.setAttribute('aria-hidden', String(!open));
        if (open) {
            // 清除未讀計數
            unreadCount = 0;
            unreadBadgeEl.style.display = 'none';
            unreadBadgeEl.textContent = '';
            // 捲到最新訊息，並聚焦輸入框
            requestAnimationFrame(() => {
                messagesEl.scrollTop = messagesEl.scrollHeight;
                inputEl.focus();
            });
        }
    }

    function renderMessages() {
        messagesEl.innerHTML = '';
        if (messages.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'chat-msg chat-msg-system';
            empty.textContent = '還沒有訊息，說點什麼吧！';
            messagesEl.appendChild(empty);
            return;
        }
        for (const msg of messages) {
            const div = document.createElement('div');
            div.className = 'chat-msg';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'chat-msg-name';
            nameSpan.textContent = `${msg.name}：`;
            div.appendChild(nameSpan);
            div.appendChild(document.createTextNode(msg.text));
            messagesEl.appendChild(div);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addMessage(msg: ChatMsg) {
        messages.push(msg);
        renderMessages();
        if (!isOpen) {
            unreadCount++;
            unreadBadgeEl.textContent = String(unreadCount);
            unreadBadgeEl.style.display = 'inline-flex';
        }
    }

    function clearMessages() {
        messages = [];
        unreadCount = 0;
        unreadBadgeEl.style.display = 'none';
        unreadBadgeEl.textContent = '';
        renderMessages();
    }

    function sendMessage() {
        const text = inputEl.value.trim();
        const room = options.getRoom();
        if (!text || !room) return;
        room.send('chat_message', { text });
        inputEl.value = '';
    }

    function bindEvents() {
        document.getElementById('chat-btn')!.onclick = () => setOpen(true);
        document.getElementById('chat-close-btn')!.onclick = () => setOpen(false);
        backdropEl.onclick = () => setOpen(false);
        sendBtn.onclick = sendMessage;
        inputEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    return { bindEvents, addMessage, clearMessages };
}
