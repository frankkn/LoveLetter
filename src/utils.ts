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
