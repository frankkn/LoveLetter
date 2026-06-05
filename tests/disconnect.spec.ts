/**
 * Disconnect / reconnect / forfeit integration tests.
 *
 * Strategy for simulating a mid-game disconnect:
 *   - We inject a script that wraps the WebSocket constructor and tracks every
 *     instance created by the page.
 *   - In the test we call page.evaluate() to close the tracked socket with
 *     code 1000 (NORMAL_CLOSURE).  Code 1000 is NOT in Colyseus SDK's
 *     auto-reconnect list ([1001, 1005, 1006, 4010]), so the SDK calls
 *     room.onLeave() immediately — which triggers our showReconnectModal().
 *   - On the server, a non-boolean consented value (1000 ≠ true) means the
 *     server calls allowReconnection(client, 20), keeping the slot open so
 *     colyseusClient.reconnect(token) can succeed.
 */

import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';

// ─── Types ───────────────────────────────────────────────────────────────────

type TestPlayer = {
    name: string;
    page: Page;
    context: BrowserContext;
    close: () => Promise<void>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Inject a script that wraps the WebSocket constructor so we can later
 * force-close connections from evaluate().
 */
async function installWSTracker(page: Page) {
    await page.addInitScript(() => {
        const _WS = window.WebSocket;
        const tracked: WebSocket[] = [];
        (window as Record<string, unknown>).__trackedWS = tracked;

        class TrackedWS extends _WS {
            constructor(url: string, protocols?: string | string[]) {
                super(url, protocols);
                tracked.push(this);
            }
        }
        window.WebSocket = TrackedWS as typeof WebSocket;
    });
}

async function createIsolatedPlayer(browser: Browser, name: string): Promise<TestPlayer> {
    const context = await browser.newContext();
    const page    = await context.newPage();

    await installWSTracker(page);

    page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') {
            await dialog.accept(name);
        } else {
            await dialog.accept();
        }
    });

    return { name, page, context, close: () => context.close() };
}

/**
 * Force-close the page's game WebSocket with code 1000.
 * - Code 1000 bypasses the Colyseus SDK's auto-reconnect path (codes
 *   1001/1005/1006/4010) so room.onLeave() fires immediately.
 * - The server still calls allowReconnection(client, 20) because
 *   consented argument is 1000 (a number ≠ true).
 */
async function forceDisconnect(page: Page) {
    await page.evaluate(() => {
        const sockets = (window as Record<string, unknown>).__trackedWS as WebSocket[] | undefined;
        if (!sockets) return;
        // Close only sockets connected to our Colyseus backend (port 2567).
        for (const ws of sockets) {
            if (ws.url.includes('2567') && ws.readyState === WebSocket.OPEN) {
                ws.close(1000, 'test-disconnect');
            }
        }
    });
}

/** Navigate to the lobby, bypassing the splash screen via JS. */
async function openOnlineLobby(page: Page) {
    await page.goto('/');
    await page.evaluate(() => {
        document.getElementById('splash-screen')?.remove();
    });
    await page.locator('#start-game-btn').click();
    await page.locator('#online-mode-btn').click();
    await expect(page.locator('#lobby-scene')).toBeVisible();
}

async function createRoom(hostPage: Page, hostName: string): Promise<string> {
    await openOnlineLobby(hostPage);
    await hostPage.locator('#create-room-btn').click();
    await hostPage.locator('#create-room-player-name').fill(hostName);
    await hostPage.locator('#confirm-create-room-btn').click();
    await expect(hostPage.locator('#room-wait-scene')).toBeVisible();
    const roomId = (await hostPage.locator('#current-room-id').textContent())?.trim();
    expect(roomId).toBeTruthy();
    return roomId!;
}

async function joinRoom(player: TestPlayer, roomId: string) {
    await openOnlineLobby(player.page);
    const joinBtn = player.page.locator(`.join-room-btn[data-room-id="${roomId}"]`);
    await expect(joinBtn).toBeVisible();
    await joinBtn.click();
    await player.page.locator('#join-room-player-name').fill(player.name);
    await player.page.locator('#confirm-join-room-btn').click();
    await expect(player.page.locator('#room-wait-scene')).toBeVisible();
}

/** Create a 2-player game and bring both players to the game scene. */
async function startTwoPlayerGame(browser: Browser): Promise<[TestPlayer, TestPlayer]> {
    const host  = await createIsolatedPlayer(browser, '房主');
    const guest = await createIsolatedPlayer(browser, '玩家B');

    const roomId = await createRoom(host.page, host.name);
    await joinRoom(guest, roomId);

    // Guest readies up
    await guest.page.locator('#ready-toggle-btn').click();
    await expect(
        guest.page.locator('.room-player-row', { hasText: guest.name }).locator('.player-status')
    ).toHaveClass(/ready/);

    // Host starts the game
    await host.page.locator('#ready-toggle-btn').click();

    // Both reach the game scene; dismiss the "Game Started" modal
    for (const player of [host, guest]) {
        await expect(player.page.locator('#game-scene')).toBeVisible({ timeout: 10_000 });
        const okBtn = player.page.locator('#game-started-ok-btn');
        if (await okBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await okBtn.click();
        }
    }

    return [host, guest];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Disconnect / reconnect / forfeit', () => {

    test('non-host sees reconnect modal on disconnect; host sees disconnect banner', async ({ browser }) => {
        test.setTimeout(30_000);

        const [host, guest] = await startTwoPlayerGame(browser);
        try {
            // Force-close guest's WS → triggers room.onLeave on guest
            await forceDisconnect(guest.page);

            // Guest should see the reconnect modal
            await expect(guest.page.locator('#modal-overlay')).toBeVisible({ timeout: 8_000 });
            await expect(guest.page.locator('#modal-title')).toContainText('斷線');
            await expect(guest.page.locator('#reconnect-btn')).toBeVisible();
            await expect(guest.page.locator('#forfeit-leave-btn')).toBeVisible();
            // Countdown text (e.g. "18 秒")
            await expect(guest.page.locator('#modal-body')).toContainText(/\d+ 秒/);

            // Host should see the disconnect banner (state update arrives from server)
            await expect(host.page.locator('#disconnect-banner')).toBeVisible({ timeout: 8_000 });
            await expect(host.page.locator('#disconnect-banner')).toContainText('玩家B');

        } finally {
            await host.close();
            await guest.close();
        }
    });

    test('non-host player can reconnect and resume the game', async ({ browser }) => {
        test.setTimeout(35_000);

        const [host, guest] = await startTwoPlayerGame(browser);
        try {
            await forceDisconnect(guest.page);

            // Wait for the reconnect modal
            await expect(guest.page.locator('#reconnect-btn')).toBeVisible({ timeout: 8_000 });

            // Click Reconnect
            await guest.page.locator('#reconnect-btn').click();

            // Guest should be back in the game
            await expect(guest.page.locator('#modal-overlay')).not.toBeVisible({ timeout: 15_000 });
            await expect(guest.page.locator('#game-scene')).toBeVisible();

            // Host's disconnect banner should disappear
            await expect(host.page.locator('#disconnect-banner')).not.toBeVisible({ timeout: 8_000 });

        } finally {
            await host.close();
            await guest.close();
        }
    });

    test('non-host player can forfeit: goes to main menu; host sees round end', async ({ browser }) => {
        test.setTimeout(30_000);

        const [host, guest] = await startTwoPlayerGame(browser);
        try {
            // "Leave Game" button visible during active online game
            await expect(guest.page.locator('#leave-game-btn')).toBeVisible({ timeout: 5_000 });

            // Guest forfeits (confirm() dialog is auto-accepted)
            await guest.page.locator('#leave-game-btn').click();

            // Guest lands on main menu
            await expect(guest.page.locator('#main-menu')).toBeVisible({ timeout: 10_000 });

            // Host: only 1 player left → end-game modal
            await expect(host.page.locator('#modal-overlay')).toBeVisible({ timeout: 10_000 });

        } finally {
            await host.close();
            await guest.close();
        }
    });

    test('HOST disconnect: host sees reconnect modal; guest sees host-disconnect banner', async ({ browser }) => {
        test.setTimeout(30_000);

        const [host, guest] = await startTwoPlayerGame(browser);
        try {
            // Force-close the HOST's WS → triggers room.onLeave on host
            await forceDisconnect(host.page);

            // Host should see the reconnect modal (same flow as any disconnected player)
            await expect(host.page.locator('#modal-overlay')).toBeVisible({ timeout: 8_000 });
            await expect(host.page.locator('#modal-title')).toContainText('斷線');
            await expect(host.page.locator('#reconnect-btn')).toBeVisible();

            // Guest should see the host-disconnect banner
            await expect(guest.page.locator('#disconnect-banner')).toBeVisible({ timeout: 8_000 });

        } finally {
            await host.close();
            await guest.close();
        }
    });

    test('HOST reconnect: host returns and game resumes for both players', async ({ browser }) => {
        test.setTimeout(40_000);

        const [host, guest] = await startTwoPlayerGame(browser);
        try {
            await forceDisconnect(host.page);

            await expect(host.page.locator('#reconnect-btn')).toBeVisible({ timeout: 8_000 });
            await host.page.locator('#reconnect-btn').click();

            // Host should be back in the game
            await expect(host.page.locator('#modal-overlay')).not.toBeVisible({ timeout: 15_000 });
            await expect(host.page.locator('#game-scene')).toBeVisible();

            // Guest's host-disconnect banner should disappear
            await expect(guest.page.locator('#disconnect-banner')).not.toBeVisible({ timeout: 8_000 });

        } finally {
            await host.close();
            await guest.close();
        }
    });

    test('non-host sees game-over modal when reconnecting after round ends', async ({ browser }) => {
        test.setTimeout(50_000);

        const [host, guest] = await startTwoPlayerGame(browser);
        try {
            // Disconnect guest while the game is still in progress
            await forceDisconnect(guest.page);
            await expect(guest.page.locator('#reconnect-btn')).toBeVisible({ timeout: 8_000 });

            // While guest is disconnected, force the round to end on the host
            // (player index 0 is always the host in a 2-player online game).
            // __testEndGame is a dev-only hook that calls endGame() + syncOnlineGameState()
            // so the server's latestGameState is updated to isGameOver: true.
            await host.page.evaluate(() => {
                (window as Record<string, unknown>).__testEndGame?.(0);
            });

            // Host should see the end-game (round result) modal
            await expect(host.page.locator('#modal-title')).toContainText(/本局結果|Round Result/, { timeout: 5_000 });

            // Guest reconnects → client sends request_game_data →
            // server replies with latestGameState (isGameOver: true) as init_game_data →
            // applyOnlineGameData must preserve isGameOver instead of forcing it to false
            await guest.page.locator('#reconnect-btn').click();

            // Guest should see the round-result modal, not a live game or blank scene
            await expect(guest.page.locator('#modal-title')).toContainText(/本局結果|Round Result/, { timeout: 20_000 });

        } finally {
            await host.close();
            await guest.close();
        }
    });

    test('clicking "Give up & Leave" in the reconnect modal returns to main menu', async ({ browser }) => {
        test.setTimeout(30_000);

        const [host, guest] = await startTwoPlayerGame(browser);
        try {
            await forceDisconnect(guest.page);

            await expect(guest.page.locator('#forfeit-leave-btn')).toBeVisible({ timeout: 8_000 });
            await guest.page.locator('#forfeit-leave-btn').click();

            // Guest chose to leave, not reconnect → main menu
            await expect(guest.page.locator('#main-menu')).toBeVisible({ timeout: 8_000 });

        } finally {
            await host.close();
            await guest.close();
        }
    });
});
