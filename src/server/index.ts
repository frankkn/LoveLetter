import { LobbyRoom, Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { NextFunction, Request, Response } from 'express';
import { LoveLetterRoom } from './rooms/LoveLetterRoom.js';

const port = Number(process.env.PORT ?? process.env.COLYSEUS_PORT ?? 2567);
const host = process.env.HOST ?? '0.0.0.0';
const allowedOrigin = process.env.CORS_ORIGIN ?? '*';

const gameServer = new Server({
    // The default WebSocket transport caps inbound messages at 4KB (maxPayload),
    // which the host's full-state `sync_game_state` can exceed in a late 4-player
    // round — the server then closes that client's socket (code 1009), surfacing
    // as an "occasional" disconnect. Raise the cap to 1MB so full-state syncs
    // always fit.
    //
    // Also relax the heartbeat: the default pingInterval(3s) × pingMaxRetries(2)
    // terminates a client after only ~6s of unresponsiveness. Mobile browsers
    // throttle/suspend WebSockets when backgrounded and flaky networks blip for
    // a few seconds, so 6s causes spurious disconnects. 3s × 4 = ~12s tolerance
    // — still well within the 20s reconnection window for genuinely dead clients.
    transport: new WebSocketTransport({
        maxPayload: 1024 * 1024, // 1MB (default is 4KB)
        pingInterval: 3000,      // ping every 3s (default)
        pingMaxRetries: 4        // terminate after ~12s unresponsive (default 2 → ~6s)
    }),
    express: app => {
        app.use((req: Request, res: Response, next: NextFunction) => {
            res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

            if (req.method === 'OPTIONS') {
                res.sendStatus(204);
                return;
            }

            next();
        });

        app.get('/health', (_req: Request, res: Response) => {
            res.status(200).send('ok');
        });
    }
});

gameServer.define('lobby', LobbyRoom);
gameServer.define('love_letter', LoveLetterRoom).enableRealtimeListing();

await gameServer.listen(port, host);
console.log(`[LoveLetterServer] Listening on ${host}:${port}`);

const shutdown = async () => {
    await gameServer.gracefullyShutdown(false);
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
