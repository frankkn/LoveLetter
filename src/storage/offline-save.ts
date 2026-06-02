import type { BaronGuardClue, GameState } from '../domain/game-state.js';

const OFFLINE_SAVE_KEY = 'loveLetter_offlineSave';

export interface OfflineSaveData {
    version: number;
    savedAt: string;
    state: Omit<GameState, 'winner'> & { winnerId: number | null };
    recentBaronGuardClue: BaronGuardClue | null;
    championThreshold: number;
}

export function hasOfflineSave(): boolean {
    return localStorage.getItem(OFFLINE_SAVE_KEY) !== null;
}

export function writeOfflineSave(data: OfflineSaveData): void {
    try {
        localStorage.setItem(OFFLINE_SAVE_KEY, JSON.stringify(data));
    } catch {
        // Ignore quota errors; saving is best-effort.
    }
}

export function clearOfflineSave(): void {
    localStorage.removeItem(OFFLINE_SAVE_KEY);
}

export function readOfflineSave(): OfflineSaveData | null {
    const raw = localStorage.getItem(OFFLINE_SAVE_KEY);
    if (!raw) return null;

    try {
        const data = JSON.parse(raw) as OfflineSaveData;
        if (data.version !== 1 || !Array.isArray(data.state?.players)) return null;
        return data;
    } catch {
        return null;
    }
}

export function updateContinueButtonVisibility(): void {
    const btn = document.getElementById('continue-game-btn') as HTMLButtonElement | null;
    if (btn) btn.style.display = hasOfflineSave() ? '' : 'none';
}
