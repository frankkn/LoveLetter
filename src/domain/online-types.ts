import type { Card } from './cards.js';
import type { Player } from './game-state.js';

// 線上對戰的狀態同步 DTO 與待處理效果（forced effect / 男爵對決 / 國王交換）型別。
// 純型別宣告，無執行期程式碼，前後端共用的遊戲狀態形狀皆在此。

export interface OnlineGameData {
    deck: Card[];
    burnedCard: Card | null;
    players: Player[];
    currentTurnPlayerId: number;
    logs: string[];
    roundIndex: number;
}

export interface PendingForcedEffect {
    reactorId: number;
    card: Card;
    sourcePlayerId: number;
    returnTurnPlayerId: number;
    shouldEndTurnAfterResolution: boolean;
}

export interface PendingBaronDuel {
    actorId: number;
    targetId: number;
    actorCard: Card;
    targetCard: Card;
    sourceCardId: string;
    confirmedPlayerIds: number[];
}

export interface PendingKingExchange {
    actorId: number;
    targetId: number;
    sourceCardId: string;
    confirmedPlayerIds: number[];
}

// Notification sent via online state sync to inform a non-host player about an effect
// that targeted them (e.g. Guard elimination, Priest peek).
export interface OnlineNotification {
    nonce: string;
    senderPlayerId: number;
    targetPlayerId: number;
    title: string;
    bodyHTML: string;
    remainingBroadcasts: number;
}

export interface OnlineGameStateData extends OnlineGameData {
    isGameOver: boolean;
    winner: Player | null;
    pendingForcedEffect?: PendingForcedEffect | null;
    pendingForcedEffectsQueue?: PendingForcedEffect[];
    pendingBaronDuel: PendingBaronDuel | null;
    pendingKingExchange?: PendingKingExchange | null;
    nextRoundReadyPlayerIds?: number[];
    restartReadyPlayerIds?: number[];
    pendingNotifications?: OnlineNotification[];
    forfeitedPlayerIds?: number[];
    // 回合結束原因（顯示在結算 modal）。只有做出最後一擊的 client 會在本地
    // 產生這個字串，其他玩家需靠同步取得，否則結算畫面的原因欄是空的。
    endGameReason?: string;
    // 增量 log 同步：當 logsBaseIndex 為正數時，`logs` 只是完整陣列從該索引起的尾段，
    // 接收端需與本地既有 logs 合併。缺省 / 0 代表 `logs` 即完整快照。
    logsBaseIndex?: number;
}
