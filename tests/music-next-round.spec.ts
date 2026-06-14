/**
 * Regression: the win/lose jingle must be interrupted when the next round starts.
 *
 * Reported bug: at round end the result modal appears and the win/lose jingle
 * plays (on the one-shot `sfxAudio`, which pauses the looping game BGM). Pressing
 * 前往下一局 (next round) did NOT stop the jingle — it kept playing to its natural
 * end before the game BGM resumed, because `showScene('game-scene')` calls
 * `playBGM(gameTrack)` and that early-returned (same track already selected),
 * never resuming the BGM nor stopping the jingle.
 *
 * Fix (music.ts): `playBGM` now interrupts a one-shot SFX that paused the BGM of
 * the same track via `stopSFX()`, so the game BGM takes over immediately.
 *
 * This test drives the round-end through the dev-only window.__testEndGame hook
 * and reads internal audio state through window.__testAudioState (both DEV-only).
 * It asserts STATE, not audible output — headless browsers can't be "listened" to.
 */

import { expect, type Page, test } from '@playwright/test';

type AudioState = {
    sfxPaused: boolean;
    bgmPaused: boolean;
    bgmPausedForSFX: boolean;
    currentBGMFile: string;
};

async function readAudioState(page: Page): Promise<AudioState> {
    return page.evaluate(
        () => (window as unknown as { __testAudioState: () => AudioState }).__testAudioState()
    );
}

/** Start a local 1-human + 2-bot game; land on the game scene with no modal. */
async function startLocalGame(page: Page) {
    await page.goto('/');
    await page.evaluate(() => document.getElementById('splash-screen')?.remove());
    await page.locator('#start-game-btn').click();
    await page.locator('#local-mode-btn').click();
    await expect(page.locator('#bot-settings-select')).toBeVisible({ timeout: 3000 });
    await page.locator('#bot-settings-start-btn').click();
    await expect(page.locator('#game-scene')).toBeVisible({ timeout: 5000 });

    // Dismiss the "game started" prompt if one appears.
    const okBtn = page.locator('#game-started-ok-btn');
    if (await okBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await okBtn.click();
    }
}

test('next round interrupts the win/lose jingle and resumes the game BGM', async ({ page }) => {
    test.setTimeout(30_000);

    await startLocalGame(page);

    // The game BGM should be the active track once we're on the game scene.
    await expect
        .poll(async () => (await readAudioState(page)).currentBGMFile, { timeout: 5000 })
        .toContain('audio/game/');

    // Force the human (player 0) to win the round → win jingle plays on sfxAudio,
    // pausing the game BGM. (Also proves the test env actually plays audio: if it
    // didn't, sfxPaused would never go false and the later assertion would be
    // meaningless.)
    await page.evaluate(() => {
        (window as unknown as { __testEndGame: (id: number) => void }).__testEndGame(0);
    });

    await expect(page.locator('#modal-overlay')).toBeVisible({ timeout: 5000 });
    await expect
        .poll(async () => (await readAudioState(page)).sfxPaused, { timeout: 5000 })
        .toBe(false); // jingle is playing
    expect((await readAudioState(page)).bgmPausedForSFX).toBe(true); // BGM paused for the jingle

    // Press 前往下一局.
    await page.locator('#next-round-btn').click();

    // FIX VERIFIED: the jingle is stopped and the game BGM is restored immediately
    // rather than waiting for the jingle to finish on its own.
    await expect
        .poll(async () => (await readAudioState(page)).sfxPaused, { timeout: 5000 })
        .toBe(true); // jingle interrupted
    const after = await readAudioState(page);
    expect(after.bgmPausedForSFX).toBe(false); // BGM no longer parked behind the jingle
    expect(after.currentBGMFile).toContain('audio/game/'); // game BGM is the active track

    // Sanity: a new round actually started (still on the game scene, no modal).
    await expect(page.locator('#game-scene')).toBeVisible();
    await expect(page.locator('#modal-overlay')).not.toBeVisible();
});
