import type { RoomAvailable } from '@colyseus/sdk';

// 大廳房列表與房間等待室的型別。純型別宣告，無執行期程式碼。
// 區分三種視角：lobby 列表摘要、本地正規化後的等待室視圖、Colyseus 同步來的原始房狀態。

export interface LobbyRoomSummary {
    roomId: string;
    playerCount: number;
    maxClients: number;
    hasPassword: boolean;
    isGameStarted: boolean;
}

export interface LobbyRoomMetadata {
    hasPassword?: boolean;
    isGameStarted?: boolean;
    botCount?: number;
}

export type LobbyRoomAddMessage =
    | RoomAvailable<LobbyRoomMetadata>
    | [string, RoomAvailable<LobbyRoomMetadata>];

export interface RoomWaitPlayerView {
    id: string;
    name: string;
    isReady: boolean;
    isHost: boolean;
    isConnected?: boolean;
    hasForfeited?: boolean;
}

export interface RoomWaitViewState {
    roomId: string;
    players: RoomWaitPlayerView[];
    selfId: string;
    isGameStarted: boolean;
    botCount: number;
    botDifficulties: string[];
    championCoins: number;
}

export interface SyncedRoomPlayerState {
    id: string;
    name: string;
    isReady: boolean;
    isHost: boolean;
    isConnected?: boolean;
    hasForfeited?: boolean;
}

export interface SyncedRoomState {
    roomId: string;
    isGameStarted: boolean;
    players: Map<string, SyncedRoomPlayerState> | Record<string, SyncedRoomPlayerState> | {
        values: () => IterableIterator<SyncedRoomPlayerState>;
    };
    botCount?: number;
    botDifficulties?: { toArray?: () => string[] } | string[];
    championCoins?: number;
}
