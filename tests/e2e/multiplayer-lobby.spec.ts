import { expect, type Page, test } from '@playwright/test';

async function openOnlineLobby(page: Page) {
    await page.goto('/');
    // Remove the splash screen immediately so it never blocks button clicks in CI.
    await page.evaluate(() => {
        document.getElementById('splash-screen')?.remove();
    });
    await page.locator('#start-game-btn').click();
    await page.locator('#online-mode-btn').click();
    await expect(page.locator('#lobby-scene')).toBeVisible();
}

async function createRoom(page: Page, playerName: string) {
    await page.locator('#create-room-btn').click();
    await page.locator('#create-room-player-name').fill(playerName);
    await page.locator('#confirm-create-room-btn').click();
    await expect(page.locator('#room-wait-scene')).toBeVisible();
    await expect(page.locator('#room-player-count')).toHaveText('1/4');
    await expect(page.locator('#room-player-list')).toContainText(playerName);
    return page.locator('#current-room-id').innerText();
}

async function joinRoom(page: Page, roomId: string, playerName: string) {
    const joinButton = page.locator(`.join-room-btn[data-room-id="${roomId}"]`);
    await expect(joinButton).toBeVisible();

    await joinButton.click();
    await page.locator('#join-room-player-name').fill(playerName);
    await page.locator('#confirm-join-room-btn').click();
    await expect(page.locator('#room-wait-scene')).toBeVisible();
}

test('two players can create, join, ready, and start through Colyseus state sync', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');

        await expect(hostPage.locator('#ready-toggle-btn')).toBeDisabled();

        await openOnlineLobby(guestPage);
        await joinRoom(guestPage, roomId, 'Bob');

        await expect(guestPage.locator('#room-player-count')).toHaveText('2/4');
        await expect(guestPage.locator('#room-player-list')).toContainText('Alice');
        await expect(guestPage.locator('#room-player-list')).toContainText('Bob');

        await expect(hostPage.locator('#room-player-count')).toHaveText('2/4');
        await expect(hostPage.locator('#room-player-list')).toContainText('Bob');
        await expect(hostPage.locator('#ready-toggle-btn')).toBeDisabled();

        await guestPage.locator('#ready-toggle-btn').click();

        await expect(guestPage.locator('.room-player-row', { hasText: 'Bob' }).locator('.player-status')).toHaveClass(/ready/);
        await expect(hostPage.locator('.room-player-row', { hasText: 'Bob' }).locator('.player-status')).toHaveClass(/ready/);
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();

        await hostPage.locator('#ready-toggle-btn').click();

        await expect(hostPage.locator('#room-wait-scene')).toHaveAttribute('data-game-started', 'true');
        await expect(guestPage.locator('#room-wait-scene')).toHaveAttribute('data-game-started', 'true');
        await expect(hostPage.locator('#game-scene')).toBeVisible();
        await expect(guestPage.locator('#game-scene')).toBeVisible();
        await expect(hostPage.locator('#player-area')).toContainText('Alice');
        await expect(guestPage.locator('#player-area')).toContainText('Bob');
        await expect(hostPage.locator('#opponents-container')).toContainText('Bob');
        await expect(guestPage.locator('#opponents-container')).toContainText('Alice');

        // Dismiss the auto-shown "遊戲開始" modal on the host so the draw button is reachable.
        const hostOkBtn = hostPage.locator('#game-started-ok-btn');
        if (await hostOkBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await hostOkBtn.click();
        }

        // Use the desktop draw button (the sidebar #draw-btn is hidden by CSS in desktop layout).
        await hostPage.locator('#draw-btn-desktop').click();
        await expect(guestPage.locator('#game-log')).toContainText('Alice');
        await expect(guestPage.locator('.opponent-area', { hasText: 'Alice' }).locator('.hand-container .card')).toHaveCount(2);
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});

test('players can copy an invite link and guests can join from it', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');

        await hostPage.locator('#invite-room-btn').click();
        await expect(hostPage.locator('#invite-room-id')).toHaveValue(roomId);
        const inviteURL = await hostPage.locator('#invite-room-url').inputValue();
        expect(inviteURL).toContain(`room=${roomId}`);
        await hostPage.locator('#invite-close-btn').click();

        await guestPage.goto(`/?room=${roomId}`);
        await expect(guestPage.locator('#modal-title')).toBeVisible();
        await expect(guestPage.locator('#join-room-player-name')).toBeVisible();
        await guestPage.locator('#join-room-player-name').fill('Bob');
        await guestPage.locator('#confirm-join-room-btn').click();

        await expect(guestPage.locator('#room-wait-scene')).toBeVisible();
        await expect(guestPage.locator('#room-player-count')).toHaveText('2/4');
        await expect(guestPage.locator('#room-player-list')).toContainText('Alice');
        await expect(guestPage.locator('#room-player-list')).toContainText('Bob');
        await expect(hostPage.locator('#room-player-list')).toContainText('Bob');
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});

test('invite link follows room capacity as bots are added and removed', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const fullGuestContext = await browser.newContext();
    const availableGuestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const fullGuestPage = await fullGuestContext.newPage();
    const availableGuestPage = await availableGuestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');

        await hostPage.locator('#invite-room-btn').click();
        const inviteURL = await hostPage.locator('#invite-room-url').inputValue();
        await hostPage.locator('#invite-close-btn').click();
        expect(inviteURL).toContain(`room=${roomId}`);

        for (let i = 0; i < 2; i++) {
            await hostPage.locator('.add-bot-btn').click();
        }
        await expect(hostPage.locator('#room-player-count')).toHaveText('3/4');

        await hostPage.locator('.add-bot-btn').click();
        await expect(hostPage.locator('#room-player-count')).toHaveText('4/4');

        await hostPage.locator('#invite-room-btn').click();
        await expect(hostPage.locator('#copy-invite-link-btn')).toBeDisabled();
        await hostPage.locator('#invite-close-btn').click();

        await fullGuestPage.goto(inviteURL);
        await expect(fullGuestPage.locator('#modal-title')).toBeVisible();
        await expect(fullGuestPage.locator('#join-room-player-name')).toHaveCount(0);
        await expect(fullGuestPage.locator('#room-wait-scene')).toBeHidden();

        await hostPage.locator('.remove-bot-btn').click();
        await expect(hostPage.locator('#room-player-count')).toHaveText('3/4');

        await hostPage.locator('#invite-room-btn').click();
        await expect(hostPage.locator('#copy-invite-link-btn')).toBeEnabled();
        await hostPage.locator('#invite-close-btn').click();

        await availableGuestPage.goto(inviteURL);
        await expect(availableGuestPage.locator('#join-room-player-name')).toBeVisible();
        await availableGuestPage.locator('#join-room-player-name').fill('Bob');
        await availableGuestPage.locator('#confirm-join-room-btn').click();

        await expect(availableGuestPage.locator('#room-wait-scene')).toBeVisible();
        await expect(availableGuestPage.locator('#room-player-count')).toHaveText('4/4');
        await expect(availableGuestPage.locator('#room-player-list')).toContainText('Bob');
        await expect(hostPage.locator('#room-player-list')).toContainText('Bob');
    } finally {
        await availableGuestContext.close();
        await fullGuestContext.close();
        await hostContext.close();
    }
});

test('invite link remains usable while bot slots leave room for guests', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');

        await hostPage.locator('#invite-room-btn').click();
        const inviteURL = await hostPage.locator('#invite-room-url').inputValue();
        await hostPage.locator('#invite-close-btn').click();
        expect(inviteURL).toContain(`room=${roomId}`);

        for (let i = 0; i < 3; i++) {
            await hostPage.locator('.add-bot-btn').click();
        }
        await expect(hostPage.locator('#room-player-count')).toHaveText('4/4');

        await hostPage.locator('.remove-bot-btn').click();
        await hostPage.locator('.remove-bot-btn').click();
        await expect(hostPage.locator('#room-player-count')).toHaveText('2/4');

        await guestPage.goto(inviteURL);
        await expect(guestPage.locator('#join-room-player-name')).toBeVisible();
        await guestPage.locator('#join-room-player-name').fill('Bob');
        await guestPage.locator('#confirm-join-room-btn').click();
        await expect(guestPage.locator('#room-wait-scene')).toBeVisible();
        await expect(guestPage.locator('#room-player-count')).toHaveText('3/4');
        await expect(hostPage.locator('#room-player-list')).toContainText('Bob');
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});

test('when a player leaves mid-game, the other player sees the abort modal and can return home', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        // Set up a 2-player game and get into the battlefield.
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');
        await openOnlineLobby(guestPage);
        await joinRoom(guestPage, roomId, 'Bob');
        await guestPage.locator('#ready-toggle-btn').click();
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();
        await hostPage.locator('#ready-toggle-btn').click();
        await expect(hostPage.locator('#game-scene')).toBeVisible();
        await expect(guestPage.locator('#game-scene')).toBeVisible();

        // Force-close any auto-shown "遊戲開始" modal so subsequent clicks reach the buttons.
        await guestPage.evaluate(() => {
            const overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.style.display = 'none';
        });

        // Simulate the host clicking "回主選單" by directly invoking the click. Bypassing the
        // native confirm() dialog this way avoids brittle Playwright dialog ordering on slow
        // headless runs while still exercising the same back-home code path on the host.
        await hostPage.evaluate(() => {
            window.confirm = () => true;
            (document.getElementById('back-home-btn') as HTMLButtonElement).click();
        });
        await expect(hostPage.locator('#main-menu')).toBeVisible();

        // The guest should detect the host's disconnect from the synced room state and
        // automatically show the abort modal after the reconnect grace period.
        await expect(guestPage.locator('#modal-overlay')).toBeVisible({ timeout: 13_000 });
        await expect(guestPage.locator('#modal-title')).toHaveText('遊戲中斷');
        await expect(guestPage.locator('#modal-body')).toContainText('Alice');

        // Clicking the modal button should reset the guest cleanly back to the main menu.
        await guestPage.locator('#game-aborted-ok-btn').click();
        await expect(guestPage.locator('#main-menu')).toBeVisible();
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});

test('cancelling target selection does not leak the played card to the opponent', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');
        await openOnlineLobby(guestPage);
        await joinRoom(guestPage, roomId, 'Bob');
        await guestPage.locator('#ready-toggle-btn').click();
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();
        await hostPage.locator('#ready-toggle-btn').click();
        await expect(hostPage.locator('#game-scene')).toBeVisible();
        await expect(guestPage.locator('#game-scene')).toBeVisible();

        // Dismiss the auto-shown "遊戲開始" modals on both clients.
        for (const page of [hostPage, guestPage]) {
            await page.evaluate(() => {
                const overlay = document.getElementById('modal-overlay');
                if (overlay) overlay.style.display = 'none';
            });
        }

        // Alice (host) draws her second card so she has 2 in hand.
        // Use the desktop draw button (the sidebar #draw-btn is hidden by CSS in desktop layout).
        await hostPage.locator('#draw-btn-desktop').click();
        await expect(hostPage.locator('#player-hand .card-wrapper')).toHaveCount(2);

        const cardNames = await hostPage.locator('#player-hand .card-wrapper .card-name').allTextContents();
        const targetCardNames = ['衛兵', '神父', '男爵', '王子', '國王'];
        const targetCardIndex = cardNames.findIndex(name => targetCardNames.includes(name));

        // ~95% of the deck-shuffles deal Alice at least one target-selecting card. If this run
        // happens to deal her only Handmaid/Countess/Princess, we can't exercise the cancel flow.
        if (targetCardIndex === -1) {
            console.log(`[test] Alice's hand: ${cardNames.join(', ')} — no target-selecting card to exercise this flow; skipping verification.`);
            return;
        }

        // Countess rule: holding the Countess (伯爵夫人) alongside the King (國王) or Prince (王子)
        // forces playing the Countess — a non-target card — so the play pops the "提示" warning
        // instead of the target-selection modal. That hand (always exactly Countess + King/Prince)
        // can't exercise the cancel flow, so skip it too.
        const hasCountess = cardNames.includes('伯爵夫人');
        const hasPrinceOrKing = cardNames.includes('國王') || cardNames.includes('王子');
        if (hasCountess && hasPrinceOrKing) {
            console.log(`[test] Alice's hand: ${cardNames.join(', ')} — Countess rule forces a non-target play; skipping verification.`);
            return;
        }

        // Bob's view of Alice before the play: 2 hidden cards in hand, empty discard pile.
        const aliceDiscardOnGuest = guestPage.locator('.opponent-area', { hasText: 'Alice' }).locator('.discard-container');
        const aliceHandOnGuest = guestPage.locator('.opponent-area', { hasText: 'Alice' }).locator('.hand-container');
        await expect(aliceDiscardOnGuest.locator('.card')).toHaveCount(0);
        await expect(aliceHandOnGuest.locator('.card')).toHaveCount(2);

        const aliceHandCards = hostPage.locator('#player-hand .card-wrapper');
        // First click selects the card, second click attempts to play it.
        await aliceHandCards.nth(targetCardIndex).click();
        await aliceHandCards.nth(targetCardIndex).click();

        // The target-selection modal should appear on Alice's screen.
        await expect(hostPage.locator('#modal-title')).toContainText('請選擇');

        // CRITICAL: while Alice is choosing a target, Bob must not see the card in her discard pile.
        // Wait a moment to let any out-of-order sync settle, then verify nothing leaked.
        await guestPage.waitForTimeout(500);
        await expect(aliceDiscardOnGuest.locator('.card')).toHaveCount(0);
        await expect(aliceHandOnGuest.locator('.card')).toHaveCount(2);

        // Alice changes her mind and clicks 返回.
        await hostPage.locator('#modal-cancel-btn').click();

        // After cancel, Bob's view must remain unchanged — no ghost play.
        await guestPage.waitForTimeout(800);
        await expect(aliceDiscardOnGuest.locator('.card')).toHaveCount(0);
        await expect(aliceHandOnGuest.locator('.card')).toHaveCount(2);
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});

test('host can add/remove bots and start a 1-real-player + 1-bot game', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();

    try {
        await openOnlineLobby(hostPage);

        // Create a room (Alice is host, 1 real player).
        await hostPage.locator('#create-room-btn').click();
        await hostPage.locator('#create-room-player-name').fill('Alice');
        await hostPage.locator('#confirm-create-room-btn').click();
        await expect(hostPage.locator('#room-wait-scene')).toBeVisible();

        // Initially 1 player, start button disabled (need >= 2 total).
        await expect(hostPage.locator('#room-player-count')).toHaveText('1/4');
        await expect(hostPage.locator('#ready-toggle-btn')).toBeDisabled();

        // Host adds a bot — player count becomes 2/4.
        await hostPage.locator('.add-bot-btn').click();
        await expect(hostPage.locator('#room-player-count')).toHaveText('2/4');
        await expect(hostPage.locator('#room-player-list')).toContainText('電腦 A');
        // Now host can start (1 real + 1 bot >= 2).
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();

        // Host removes the bot — back to 1/4, start disabled again.
        await hostPage.locator('.remove-bot-btn').click();
        await expect(hostPage.locator('#room-player-count')).toHaveText('1/4');
        await expect(hostPage.locator('#ready-toggle-btn')).toBeDisabled();

        // Add the bot back and start the game.
        await hostPage.locator('.add-bot-btn').click();
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();
        await hostPage.locator('#ready-toggle-btn').click();

        // Game should start — game-scene visible, bot opponent rendered.
        await expect(hostPage.locator('#game-scene')).toBeVisible({ timeout: 5000 });
        await expect(hostPage.locator('#player-area')).toContainText('Alice');
        await expect(hostPage.locator('#opponents-container')).toContainText('電腦 A');

        // Alice draws her card so the game advances normally.
        await hostPage.evaluate(() => {
            const overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.style.display = 'none';
        });
        // Use the desktop draw button (the sidebar #draw-btn is hidden by CSS in desktop layout).
        await hostPage.locator('#draw-btn-desktop').click();
        // Alice should now have 2 cards in hand.
        await expect(hostPage.locator('#player-hand .card-wrapper')).toHaveCount(2);
    } finally {
        await hostContext.close();
    }
});

test('host can kick a real player who then returns to the lobby', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');

        await openOnlineLobby(guestPage);
        await joinRoom(guestPage, roomId, 'Bob');

        // Bob should be visible in both views.
        await expect(hostPage.locator('#room-player-list')).toContainText('Bob');
        await expect(guestPage.locator('#room-player-list')).toContainText('Bob');

        // Alice (host) kicks Bob.
        const kickBtn = hostPage.locator('.kick-player-btn');
        await expect(kickBtn).toBeVisible();
        await kickBtn.click();

        // Bob sees a kicked notification modal, then the lobby.
        await expect(guestPage.locator('#modal-overlay')).toBeVisible({ timeout: 5000 });
        await guestPage.locator('#kicked-ok-btn').click();
        await expect(guestPage.locator('#lobby-scene')).toBeVisible();

        // Host room now shows 1 player again.
        await expect(hostPage.locator('#room-player-count')).toHaveText('1/4');
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});
