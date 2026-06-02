/** 多人房間邀請連結的 URL 工具（讀取 / 清除 / 產生 `?room=` 參數） */

/** 從目前網址讀取邀請的房間 ID（`?room=...`），無則回傳 null */
export function getInviteRoomIdFromURL(): string | null {
    return new URLSearchParams(window.location.search).get('room')?.trim() || null;
}

/** 從網址移除 `room` 參數（不重新載入頁面） */
export function clearInviteRoomIdFromURL() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('room')) return;
    url.searchParams.delete('room');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

/** 為指定房間 ID 產生可分享的邀請連結 */
export function getRoomInviteURL(roomId: string): string {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    return url.toString();
}
