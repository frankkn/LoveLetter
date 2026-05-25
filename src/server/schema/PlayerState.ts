import { Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
    @type("string")
    id = "";

    @type("string")
    name = "";

    @type("boolean")
    isReady = false;

    @type("boolean")
    isHost = false;

    @type("boolean")
    isConnected = true;

    @type("boolean")
    hasForfeited = false;
}
