/**
 * Regression: round-result / champion modals after a league restart.
 *
 * Reproduces the reported bug: in online multiplayer, the first league works,
 * but after pressing 重新開始 (restart) the NEXT league silently skips the
 * round-result / winner modals and wipes coins.
 *
 * Root cause (fixed in applyOnlineGameState): `restartReadyPlayerIds` was never
 * reset on non-host clients when a new round/league started, so the stale
 * "everyone confirmed restart" list propagated back to the host on the next
 * round-end sync and triggered an unwanted startNewLeague() — resetting coins
 * and closing the modals before anyone could see them.
 *
 * These tests drive round-ends through the dev-only window.__testEndGame hook
 * (the same hook disconnect.spec.ts uses).  ?dev=1 sets championThreshold = 1,
 * so a single round win = league champion, keeping the test fast.
 */

import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';

type TestPlayer = {
    name: string;
    page: Page;
    context: BrowserContext;
    close: () => Promise<void>;
};

const ROUND_RESULT = /本局結果|Round Result/;

async function createIsolatedPlayer(browser: Browser, name: string): Promise<TestPlayer> {
    const context = await browser.newContext();
    const page    = await context.newPage();

    page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') await dialog.accept(name);
        else await dialog.accept();
    });

    return { name, page, context, close: () => context.close() };
}

/** Navigate to the lobby. `dev` enables ?dev=1 (championThreshold = 1). */
async function openOnlineLobby(page: Page, dev: boolean) {
    await page.goto(dev ? '/?dev=1' : '/');
    await page.evaluate(() => document.getElementById('splash-screen')?.remove());
    await page.locator('#start-game-btn').click();
    await page.locator('#online-mode-btn').click();
    await expect(page.locator('#lobby-scene')).toBeVisible();
}

async function createRoom(host: TestPlayer, dev: boolean): Promise<string> {
    await openOnlineLobby(host.page, dev);
    await host.page.locator('#create-room-btn').click();
    await host.page.locator('#create-room-player-name').fill(host.name);
    await host.page.locator('#confirm-create-room-btn').click();
    await expect(host.page.locator('#room-wait-scene')).toBeVisible();
    const roomId = (await host.page.locator('#current-room-id').textContent())?.trim();
    expect(roomId).toBeTruthy();
    return roomId!;
}

async function joinRoom(player: TestPlayer, roomId: string, dev: boolean) {
    await openOnlineLobby(player.page, dev);
    const joinBtn = player.page.locator(`.join-room-btn[data-room-id="${roomId}"]`);
    await expect(joinBtn).toBeVisible();
    await joinBtn.click();
    await player.page.locator('#join-room-player-name').fill(player.name);
    await player.page.locator('#confirm-join-room-btn').click();
    await expect(player.page.locator('#room-wait-scene')).toBeVisible();
}

/** Create a 2-player game; both reach the game scene with the start modal dismissed. */
async function startTwoPlayerGame(browser: Browser, dev: boolean): Promise<[TestPlayer, TestPlayer]> {
    const host  = await createIsolatedPlayer(browser, '房主');
    const guest = await createIsolatedPlayer(browser, '玩家B');

    const roomId = await createRoom(host, dev);
    await joinRoom(guest, roomId, dev);

    await guest.page.locator('#ready-toggle-btn').click();
    await expect(
        guest.page.locator('.room-player-row', { hasText: guest.name }).locator('.player-status')
    ).toHaveClass(/ready/);

    await host.page.locator('#ready-toggle-btn').click();

    for (const player of [host, guest]) {
        await expect(player.page.locator('#game-scene')).toBeVisible({ timeout: 10_000 });
        const okBtn = player.page.locator('#game-started-ok-btn');
        if (await okBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await okBtn.click();
        }
    }

    return [host, guest];
}

/** Force the current round to end with `winnerId` winning, via the dev hook. */
async function forceRoundEnd(page: Page, winnerId: number) {
    await page.evaluate(id => {
        (window as Record<string, unknown>).__testEndGame?.(id as number);
    }, winnerId);
}

test.describe('Online round-result / champion modals', () => {

    test('both players see the round-result modal when a round ends', async ({ browser }) => {
        test.setTimeout(45_000);

        // No dev mode → championThreshold = 4, so a single round win is NOT a
        // champion yet. This exercises the "modal before winning" case the user
        // asked about: a round ends, both players should see 本局結果.
        const [host, guest] = await startTwoPlayerGame(browser, /* dev */ false);
        try {
            await forceRoundEnd(host.page, 0); // host wins the round (coins → 1)

            for (const player of [host, guest]) {
                await expect(player.page.locator('#modal-overlay')).toBeVisible({ timeout: 10_000 });
                await expect(player.page.locator('#modal-title')).toContainText(ROUND_RESULT);
            }

            // Not a champion yet (threshold 4) → the primary button is "next round".
            await expect(host.page.locator('#next-round-btn')).toBeVisible();
            await expect(guest.page.locator('#next-round-btn')).toBeVisible();
        } finally {
            await host.close();
            await guest.close();
        }
    });

    test('after a league restart, both players still see the round modal and coins persist', async ({ browser }) => {
        test.setTimeout(60_000);

        // dev mode → championThreshold = 1, so one round win = league champion.
        const [host, guest] = await startTwoPlayerGame(browser, /* dev */ true);
        try {
            // ── League 1: host wins → champion ──────────────────────────────
            await forceRoundEnd(host.page, 0);

            for (const player of [host, guest]) {
                await expect(player.page.locator('#modal-overlay')).toBeVisible({ timeout: 10_000 });
                await expect(player.page.locator('#modal-title')).toContainText(ROUND_RESULT);
                // Champion reached (threshold 1) → primary button views the champion.
                await expect(player.page.locator('#view-champion-btn')).toBeVisible();
            }

            // ── Both players confirm 重新開始 (restart league) ───────────────
            for (const player of [host, guest]) {
                await player.page.locator('#view-champion-btn').click();
                await expect(player.page.locator('#champion-restart-btn')).toBeVisible();
                await player.page.locator('#champion-restart-btn').click();
            }

            // Host starts league 2 once both confirmed → modals close on both.
            for (const player of [host, guest]) {
                await expect(player.page.locator('#modal-overlay')).not.toBeVisible({ timeout: 15_000 });
                await expect(player.page.locator('#turn-indicator')).not.toHaveText('');
            }

            // ── League 2: the GUEST (non-host) ends the round ────────────────
            // This is the trigger that surfaced the bug: a non-host's stale
            // restartReadyPlayerIds rode along in its game-over sync and made the
            // host auto-restart, wiping coins and skipping the modal.
            await forceRoundEnd(guest.page, 1); // guest wins the round (coins → 1)

            // FIX VERIFIED: both players see the round-result modal (no silent skip).
            for (const player of [host, guest]) {
                await expect(player.page.locator('#modal-overlay')).toBeVisible({ timeout: 10_000 });
                await expect(player.page.locator('#modal-title')).toContainText(ROUND_RESULT);
            }

            // Coins were NOT wiped: the league-2 winner shows at least one coin in
            // the result ranking. (A buggy auto-restart would reset coins to 0 and
            // show no modal at all.)
            await expect(guest.page.locator('#modal-body .coin-icon').first()).toBeVisible({ timeout: 5_000 });
            await expect(host.page.locator('#modal-body .coin-icon').first()).toBeVisible({ timeout: 5_000 });
        } finally {
            await host.close();
            await guest.close();
        }
    });
});
