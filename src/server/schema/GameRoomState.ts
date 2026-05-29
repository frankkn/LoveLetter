import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState.js";

export class GameRoomState extends Schema {
    @type("string")
    roomId = "";

    @type("boolean")
    hasPassword = false;

    @type("boolean")
    isGameStarted = false;

    @type({ map: PlayerState })
    players = new MapSchema<PlayerState>();

    @type("number")
    botCount = 0;

    @type(["string"])
    botDifficulties = new ArraySchema<string>();

    @type("number")
    championCoins = 4;
}
