/**
 * Regression test: `handKnownToOpponent` must reset on a new round.
 *
 * A Priest peek / King swap sets a player's `handKnownToOpponent = true`. The
 * flag lived on the reused Player object across rounds, but startNextRound
 * (shared by offline + online "next round") only reset hand/protection/alive/
 * discard/reveal — not this flag. A player peeked in round N would start round
 * N+1 still flagged "hand known", misleading the AI (needless self-Prince wash,
 * inflated Handmaid weight) even though the new hand was freshly dealt.
 *
 * Driven via DEV-only hooks (tree-shaken from production builds): set the flag,
 * force a next round, and read it back.
 */
import { expect, type Page, test } from '@playwright/test';

async function startLocalGame(page: Page, botCount: 1 | 2 | 3) {
    await page.goto('/');
    await page.evaluate(() => document.getElementById('splash-screen')?.remove());
    await page.locator('#start-game-btn').click();
    await page.locator('#local-mode-btn').click();
    await expect(page.locator('#bot-settings-select')).toBeVisible({ timeout: 3000 });
    const delta = botCount - 2;
    const arrowId = delta > 0 ? '#botcount-arrow-right' : '#botcount-arrow-left';
    for (let i = 0; i < Math.abs(delta); i++) {
        await page.locator(arrowId).click();
    }
    await page.locator('#bot-settings-start-btn').click();
    await expect(page.locator('#game-scene')).toBeVisible({ timeout: 5000 });
}

test('handKnownToOpponent clears for every player when a new round starts', async ({ page }) => {
    await startLocalGame(page, 2); // 1 human + 2 bots

    // Simulate every player's hand having been exposed in the current round.
    await page.evaluate(() => (window as any).__testSetAllHandKnown(true));
    const before = await page.evaluate(() => (window as any).__testHandKnownFlags() as boolean[]);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every(Boolean)).toBe(true); // sanity: all flagged exposed

    // Start the next round through the real startNextRound path.
    await page.evaluate(() => (window as any).__testStartNextRound());

    const after = await page.evaluate(() => (window as any).__testHandKnownFlags() as boolean[]);
    expect(after.length).toBe(before.length);
    // Freshly dealt hands — nobody has seen them, so the flag must be cleared.
    expect(after.every(flag => flag === false)).toBe(true);
});
