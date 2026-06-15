/**
 * Pure-logic tests for releasing interactions blocked on a departed player.
 *
 * A Baron duel / King exchange waits for BOTH participants to confirm, and a
 * Prince-forced effect waits for its reactor to resolve it. If that player
 * disconnects/forfeits mid-interaction the round soft-locks. These helpers
 * release the block. Run in the Vite-served page (the domain modules import
 * `.webp`, so they can't load in a Node test runner).
 */
import { test, expect, type Page } from '@playwright/test';

async function loadModule(page: Page) {
    await page.goto('/');
    return page.evaluate(async () => {
        const resolve = (p: string) => new URL(p, document.baseURI).href;
        const mod = await import(/* @vite-ignore */ resolve('src/net/online-reconcile.ts'));
        (window as unknown as Record<string, unknown>).__reconcile = mod;
        return true;
    });
}

const duel = (over: Partial<{ actorId: number; targetId: number; confirmedPlayerIds: number[] }> = {}) => ({
    actorId: 1, targetId: 2,
    actorCard: { id: 'a', type: 3, name: '', value: 3, description: '' },
    targetCard: { id: 'b', type: 5, name: '', value: 5, description: '' },
    sourceCardId: 'a', confirmedPlayerIds: [1], ...over
});

const exchange = (over: Partial<{ actorId: number; targetId: number; confirmedPlayerIds: number[] }> = {}) => ({
    actorId: 1, targetId: 2, sourceCardId: 'k', confirmedPlayerIds: [1], ...over
});

const effect = (reactorId: number, returnTurnPlayerId = 1, shouldEndTurnAfterResolution = true) => ({
    reactorId, returnTurnPlayerId, shouldEndTurnAfterResolution,
    card: { id: `c${reactorId}`, type: 1, name: '', value: 1, description: '' },
    sourcePlayerId: returnTurnPlayerId
});

test.describe('releaseBaronDuelForDepartedPlayer', () => {
    test('target departs → auto-confirms the target so the actor can finish', async ({ page }) => {
        await loadModule(page);
        const result = await page.evaluate(([d]) => {
            const { releaseBaronDuelForDepartedPlayer } = (window as any).__reconcile;
            const out = releaseBaronDuelForDepartedPlayer(d, 2);
            return { confirmed: out?.confirmedPlayerIds, isNull: out === null };
        }, [duel()] as const);
        expect(result.isNull).toBe(false);
        expect(result.confirmed).toEqual([1, 2]);
    });

    test('actor departs → voids the duel (orphaned resolution)', async ({ page }) => {
        await loadModule(page);
        const isNull = await page.evaluate(([d]) => {
            const { releaseBaronDuelForDepartedPlayer } = (window as any).__reconcile;
            return releaseBaronDuelForDepartedPlayer(d, 1) === null;
        }, [duel()] as const);
        expect(isNull).toBe(true);
    });

    test('uninvolved player departs → duel unchanged', async ({ page }) => {
        await loadModule(page);
        const same = await page.evaluate(([d]) => {
            const { releaseBaronDuelForDepartedPlayer } = (window as any).__reconcile;
            return releaseBaronDuelForDepartedPlayer(d, 3) === d;
        }, [duel()] as const);
        expect(same).toBe(true);
    });

    test('already-confirmed target departs → no duplicate confirmation', async ({ page }) => {
        await loadModule(page);
        const confirmed = await page.evaluate(([d]) => {
            const { releaseBaronDuelForDepartedPlayer } = (window as any).__reconcile;
            return releaseBaronDuelForDepartedPlayer(d, 2)?.confirmedPlayerIds;
        }, [duel({ confirmedPlayerIds: [1, 2] })] as const);
        expect(confirmed).toEqual([1, 2]);
    });
});

test.describe('releaseKingExchangeForDepartedPlayer', () => {
    test('target departs → auto-confirms; actor departs → voids', async ({ page }) => {
        await loadModule(page);
        const result = await page.evaluate(([e]) => {
            const { releaseKingExchangeForDepartedPlayer } = (window as any).__reconcile;
            return {
                targetGone: releaseKingExchangeForDepartedPlayer(e, 2)?.confirmedPlayerIds,
                actorGone: releaseKingExchangeForDepartedPlayer(e, 1),
                uninvolved: releaseKingExchangeForDepartedPlayer(e, 3) === e
            };
        }, [exchange()] as const);
        expect(result.targetGone).toEqual([1, 2]);
        expect(result.actorGone).toBe(null);
        expect(result.uninvolved).toBe(true);
    });
});

test.describe('dropForcedEffectsForDepartedReactor', () => {
    test('drops the departed reactor entries and resumes the parked turn when drained', async ({ page }) => {
        await loadModule(page);
        const result = await page.evaluate(([e]) => {
            const { dropForcedEffectsForDepartedReactor } = (window as any).__reconcile;
            const out = dropForcedEffectsForDepartedReactor([e], 2);
            return { len: out.queue.length, resumerReturn: out.turnResumer?.returnTurnPlayerId };
        }, [effect(2, 1)] as const);
        expect(result.len).toBe(0);
        expect(result.resumerReturn).toBe(1); // resume the actor's turn
    });

    test('keeps other reactors and does not resume while the queue is non-empty', async ({ page }) => {
        await loadModule(page);
        const result = await page.evaluate(([dep, keep]) => {
            const { dropForcedEffectsForDepartedReactor } = (window as any).__reconcile;
            const out = dropForcedEffectsForDepartedReactor([dep, keep], 2);
            return { remainingReactors: out.queue.map((x: any) => x.reactorId), hasResumer: out.turnResumer !== null };
        }, [effect(2, 1), effect(3, 1)] as const);
        expect(result.remainingReactors).toEqual([3]);
        expect(result.hasResumer).toBe(false);
    });

    test('no matching reactor → queue and resumer untouched', async ({ page }) => {
        await loadModule(page);
        const result = await page.evaluate(([e]) => {
            const { dropForcedEffectsForDepartedReactor } = (window as any).__reconcile;
            const out = dropForcedEffectsForDepartedReactor([e], 9);
            return { len: out.queue.length, hasResumer: out.turnResumer !== null };
        }, [effect(2, 1)] as const);
        expect(result.len).toBe(1);
        expect(result.hasResumer).toBe(false);
    });
});
