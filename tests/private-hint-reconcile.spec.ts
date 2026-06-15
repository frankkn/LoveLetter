import { test, expect, type Page } from '@playwright/test';

// Pure-logic tests for the online private-hint reconciliation fix. They run inside
// the Vite-served page (not Node) because the domain modules transitively import
// `.webp` assets that only Vite can resolve. Each case drives the real
// `createDeck` / `restoreLocalPrivateHints` exports via a browser-side dynamic
// import.
//
// Bug guarded: a previous round's Priest private hint ("你看到了 X") leaking onto a
// fresh card in a later round, surfacing the hint under a card in the local
// player's own hand during multiplayer.

// Resolve the dev-server module URL regardless of Vite's configured base.
async function loadModules(page: Page) {
    await page.goto('/');
    return page.evaluate(async () => {
        // baseURI already includes Vite's configured base (e.g. /love-letter/),
        // so relative module paths resolve correctly without hardcoding it.
        const resolve = (p: string) => new URL(p, document.baseURI).href;
        const cards = await import(/* @vite-ignore */ resolve('src/domain/cards.ts'));
        const reconcile = await import(/* @vite-ignore */ resolve('src/net/online-reconcile.ts'));
        // Expose for subsequent evaluate() calls.
        (window as unknown as Record<string, unknown>).__cards = cards;
        (window as unknown as Record<string, unknown>).__reconcile = reconcile;
        return true;
    });
}

test('createDeck: ids are globally unique across consecutive decks', async ({ page }) => {
    await loadModules(page);

    const result = await page.evaluate(() => {
        const { createDeck } = (window as any).__cards;
        const deckA = createDeck().map((c: any) => c.id);
        const deckB = createDeck().map((c: any) => c.id);
        const overlap = deckA.filter((id: string) => deckB.includes(id));
        return {
            uniqueWithinA: new Set(deckA).size === deckA.length,
            overlapCount: overlap.length
        };
    });

    expect(result.uniqueWithinA).toBe(true);
    // Old behaviour reset the counter per deck, so card-3 meant a different card
    // each round. With a session-global counter there is zero cross-deck overlap.
    expect(result.overlapCount).toBe(0);
});

test('restoreLocalPrivateHints: restores a private hint within the same round', async ({ page }) => {
    await loadModules(page);

    const result = await page.evaluate(() => {
        const { restoreLocalPrivateHints } = (window as any).__reconcile;
        const makePlayer = (id: number, extra: any = {}) => ({
            id, name: `P${id}`, isBot: false, coins: 0, hand: [],
            isProtected: false, isAlive: true, discardPile: [], ...extra
        });
        const priest = {
            id: 'card-3', type: 2, name: '神父', value: 2, description: '',
            privateActionHints: [{ text: '你看到了公主', variant: 'default' }],
            privateHintOwnerId: 0
        };
        const state = {
            deck: [], burnedCard: null, currentTurnPlayerId: 0, isGameOver: false,
            winner: null, logs: [], aiMemory: {}, aiExcludedGuesses: {}, roundIndex: 5,
            players: [makePlayer(0, { discardPile: [priest] }), makePlayer(1)]
        };
        const incoming = [
            makePlayer(0, { discardPile: [{ id: 'card-3', type: 2, name: '神父', value: 2, description: '' }] }),
            makePlayer(1)
        ];
        const out = restoreLocalPrivateHints(state, 0, incoming, 5);
        const card = out[0].discardPile[0];
        return { owner: card.privateHintOwnerId, hint: card.privateActionHints?.[0]?.text };
    });

    expect(result.owner).toBe(0);
    expect(result.hint).toBe('你看到了公主');
});

test('restoreLocalPrivateHints: round guard blocks cross-round hint leak onto a new hand card', async ({ page }) => {
    await loadModules(page);

    const result = await page.evaluate(() => {
        const { restoreLocalPrivateHints } = (window as any).__reconcile;
        const makePlayer = (id: number, extra: any = {}) => ({
            id, name: `P${id}`, isBot: false, coins: 0, hand: [],
            isProtected: false, isAlive: true, discardPile: [], ...extra
        });
        // Previous round (5): local player discarded a Priest with id card-3 + hint.
        const state = {
            deck: [], burnedCard: null, currentTurnPlayerId: 0, isGameOver: false,
            winner: null, logs: [], aiMemory: {}, aiExcludedGuesses: {}, roundIndex: 5,
            players: [
                makePlayer(0, { discardPile: [{
                    id: 'card-3', type: 2, name: '神父', value: 2, description: '',
                    privateActionHints: [{ text: '你看到了公主', variant: 'default' }],
                    privateHintOwnerId: 0
                }] }),
                makePlayer(1)
            ]
        };
        // New round (6): local player now HOLDS a fresh card that reuses id card-3.
        const incoming = [
            makePlayer(0, { hand: [{ id: 'card-3', type: 1, name: '衛兵', value: 1, description: '' }] }),
            makePlayer(1)
        ];
        const out = restoreLocalPrivateHints(state, 0, incoming, 6);
        const handCard = out[0].hand[0];
        return {
            hasPrivateHints: handCard.privateActionHints !== undefined,
            hasOwner: handCard.privateHintOwnerId !== undefined
        };
    });

    expect(result.hasPrivateHints).toBe(false);
    expect(result.hasOwner).toBe(false);
});

test('restoreLocalPrivateHints: legacy payload without roundIndex still restores by id', async ({ page }) => {
    await loadModules(page);

    const result = await page.evaluate(() => {
        const { restoreLocalPrivateHints } = (window as any).__reconcile;
        const makePlayer = (id: number, extra: any = {}) => ({
            id, name: `P${id}`, isBot: false, coins: 0, hand: [],
            isProtected: false, isAlive: true, discardPile: [], ...extra
        });
        const state = {
            deck: [], burnedCard: null, currentTurnPlayerId: 0, isGameOver: false,
            winner: null, logs: [], aiMemory: {}, aiExcludedGuesses: {}, roundIndex: 5,
            players: [makePlayer(0, { discardPile: [{
                id: 'card-3', type: 2, name: '神父', value: 2, description: '',
                privateActionHints: [{ text: '你看到了公主', variant: 'default' }],
                privateHintOwnerId: 0
            }] }), makePlayer(1)]
        };
        const incoming = [
            makePlayer(0, { discardPile: [{ id: 'card-3', type: 2, name: '神父', value: 2, description: '' }] }),
            makePlayer(1)
        ];
        const out = restoreLocalPrivateHints(state, 0, incoming); // no roundIndex
        return { owner: out[0].discardPile[0].privateHintOwnerId };
    });

    expect(result.owner).toBe(0);
});
