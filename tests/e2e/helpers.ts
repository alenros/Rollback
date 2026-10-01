import type { Page } from '@playwright/test';

/** Create a room as host; returns the room code. */
export async function createPlayerAndRoom(page: Page, playerName: string): Promise<string> {
  await page.goto('/');
  await page.fill('#player-name', playerName);
  await page.click('#create-room-btn');
  await page.waitForURL(/\/lobby\?code=/, { timeout: 10000 });

  const roomCode = new URL(page.url()).searchParams.get('code');
  if (!roomCode) throw new Error('Failed to extract room code from URL');
  return roomCode;
}

/** Join an existing room as a guest. */
export async function joinRoom(page: Page, playerName: string, roomCode: string): Promise<void> {
  await page.goto('/');
  await page.fill('#player-name', playerName);
  await page.click('#join-room-btn');
  await page.waitForURL('/join', { timeout: 5000 });
  await page.fill('#join-code', roomCode);
  await page.click('#join-room-btn');
  await page.waitForURL(/\/lobby\?code=/, { timeout: 10000 });
}

/**
 * Delete a test room from Firebase. Runs inside a page (via Vite's dev module
 * server) so it uses the browser's network path: Node's own Firebase connection
 * can be blocked by proxies. Gives up after 10s rather than hanging the suite.
 */
export async function cleanupRoom(page: Page, roomCode: string): Promise<void> {
  if (!roomCode) return;
  await page.goto('/'); // a page that isn't watching the room, so deleting it doesn't navigate away
  const remove = page.evaluate(async ({ code, modulePath }) => {
    const { getDatabase } = await import(/* @vite-ignore */ modulePath);
    await getDatabase().ref(`rooms/${code}`).remove();
  }, { code: roomCode, modulePath: '/src/lib/firebase.ts' });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 10000));
  try {
    await Promise.race([remove, timeout]);
  } catch (error) {
    console.warn(`Failed to cleanup room ${roomCode}:`, error);
  }
}

/** Of the given pages, the one whose player is to act. */
export async function pageWithTurn(pages: Page[]): Promise<Page> {
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const page of pages) {
      if (await page.locator('body.my-turn').count()) return page;
    }
    await pages[0].waitForTimeout(200);
  }
  throw new Error('No player has the turn');
}
