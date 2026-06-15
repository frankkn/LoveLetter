/** 通用工具函式（無遊戲狀態相依） */

/** 等待指定毫秒數的 Promise */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 將字串中的 HTML 特殊字元轉義，避免注入 */
export function escapeHTML(value: string): string {
    return value.replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[char]!);
}

/**
 * 清洗玩家暱稱：移除可形成 HTML 標籤的角括號，並限制長度。
 * 暱稱會被同時用在 innerHTML（modal、卡牌提示）與 textContent（回合指示、戰報）情境，
 * 故採「移除角括號」而非 entity 編碼——這樣同一份字串在兩種情境都安全且顯示一致，
 * 不會在 textContent 出現 `&lt;` 之類的殘渣。去掉 `<`/`>` 後即無法組出 HTML 標籤；
 * 引號等其餘字元則由 innerHTML sink 的 escapeHTML 作為縱深防禦處理。
 */
export function sanitizePlayerName(raw: string | undefined | null): string {
    return (raw ?? '')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, 24);
}

/** 為 Promise 加上逾時限制；超過 timeoutMs 未完成則以 message 拒絕 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        promise
            .then(resolve)
            .catch(reject)
            .finally(() => window.clearTimeout(timeoutId));
    });
}
