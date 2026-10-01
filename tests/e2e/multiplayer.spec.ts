import { test, expect, type Browser, type Page } from '@playwright/test';
import { cleanupRoom, createPlayerAndRoom, joinRoom, pageWithTurn } from './helpers';

test.describe('Three-player game flow', () => {
  let browser: Browser;
  let pages: Page[];
  let roomCode: string;
  const warnings: string[] = [];

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
    // Separate contexts = separate localStorage = separate players.
    pages = await Promise.all([0, 1, 2].map(async () => (await browser.newContext()).newPage()));
    for (const page of pages) {
      page.on('console', msg => {
        if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text());
      });
    }
  });

  test.afterAll(async () => {
    await cleanupRoom(pages[0], roomCode);
    await Promise.all(pages.map(p => p.context().close()));
  });

  test('players gather in the lobby; start needs 2', async () => {
    const [alice, bob, cara] = pages;
    roomCode = await createPlayerAndRoom(alice, 'Alice');
    expect(roomCode).toHaveLength(6);
    await expect(alice.locator('#display-room-code')).toHaveText(roomCode);
    await expect(alice.locator('#start-game-btn')).toBeHidden();

    await joinRoom(bob, 'Bob', roomCode);
    await expect(alice.locator('#start-game-btn')).toBeVisible();

    await joinRoom(cara, 'Cara', roomCode);
    for (const page of pages) {
      for (const name of ['Alice', 'Bob', 'Cara']) {
        await expect(page.locator('#players-container')).toContainText(name);
      }
    }
    await expect(bob.locator('#start-game-btn')).toBeHidden();
  });

  test('host starts; everyone gets 9 dice; leader plays and the next player passes', async () => {
    await pages[0].click('#start-game-btn');
    for (const page of pages) {
      await page.waitForURL(/\/game\?code=/, { timeout: 10000 });
      await expect(page.locator('#hand .die')).toHaveCount(9);
    }

    const leader = await pageWithTurn(pages);
    await leader.locator('#hand .die').first().click();
    await expect(leader.locator('#play-btn')).toBeEnabled();
    await leader.click('#play-btn');

    for (const page of pages) {
      await expect(page.locator('#table-play .die')).toHaveCount(1);
    }
    await expect(leader.locator('#hand .die')).toHaveCount(8);

    const next = await pageWithTurn(pages.filter(p => p !== leader));
    await next.locator('#hand .die').first().click(); // reroll one die while passing
    await next.click('#pass-btn');
    await expect(next.locator('#seats .badge-passed')).toHaveCount(1);
    await expect(next.locator('#hand .die.fresh')).toHaveCount(1);
  });

  test('telemetry writes are accepted by the database rules', async () => {
    await pages[0].waitForTimeout(2000); // let fire-and-forget writes settle
    expect(warnings.filter(w => /telemetry|permission/i.test(w))).toEqual([]);
  });
});
