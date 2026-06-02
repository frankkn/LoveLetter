import type { Card, CardType } from './cards.js';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface Player {
    id: number;           // 0 為人類玩家，1~3 為電腦
    name: string;         // "玩家", "電腦 A", "電腦 B", "電腦 C"
    isBot: boolean;       // 是否為電腦
    difficulty?: BotDifficulty; // 僅 bot 使用
    coins: number;        // 聯賽硬幣數，先取得 4 枚者獲勝
    hand: Card[];         // 手牌 (1~2張)
    isProtected: boolean; // 侍女保護狀態
    isAlive: boolean;     // 是否還活著
    discardPile: Card[];  // 已打出的牌堆
    isHandRevealed?: boolean;      // 是否需在畫面上暫時強制翻開手牌
    handKnownToOpponent?: boolean; // 神父/國王後，目前手牌已被對手得知
}

export interface GameState {
    deck: Card[];
    burnedCard: Card | null;
    players: Player[];
    currentTurnPlayerId: number;
    isGameOver: boolean;
    winner: Player | null;
    logs: string[];
    aiMemory: Record<number, Record<number, CardType>>;
    aiExcludedGuesses: Record<number, Record<number, CardType[]>>;
    // Monotonically increasing per round. Used to discard stale online syncs that arrive
    // after a newer round has already started locally (3+ player "next round" race).
    roundIndex: number;
}

export interface PlayRollback {
    playerId: number;
    hand: Card[];
    discardPile: Card[];
    isProtected: boolean;
    logLength: number;
}

export interface PrinceDiscardResult {
    discarded: Card | null;
    hasPendingForcedEffect: boolean;
}

export interface BaronGuardClue {
    winnerId: number;
    loserId: number;
    loserCardType: CardType;
    sourceCardId: string;
}
