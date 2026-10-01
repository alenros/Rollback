import { test, expect } from '@playwright/test';
import { cleanupRoom, createPlayerAndRoom } from './helpers';

test('an invite link lets a new player pick a name and land in the room', async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let roomCode = '';
  try {
    roomCode = await createPlayerAndRoom(host, 'Alice');

    await host.click('#share-invite-btn');
    await expect(host.locator('#share-status')).toHaveText(/copied/);
    const inviteUrl = await host.evaluate(() => navigator.clipboard.readText());
    expect(new URL(inviteUrl).pathname).toMatch(/\/join$/);
    expect(new URL(inviteUrl).searchParams.get('code')).toBe(roomCode);

    // A fresh browser following the link only has to choose a name.
    await guest.goto(inviteUrl);
    await expect(guest.locator('#join-code')).toHaveValue(roomCode);
    await expect(guest.locator('#player-name')).toBeFocused();
    await guest.fill('#player-name', 'Bob');
    await guest.click('#join-room-btn');
    await guest.waitForURL(/\/lobby\?code=/, { timeout: 10000 });
    await expect(host.locator('#players-container')).toContainText('Bob');

    // The host opening their own link goes straight back to the lobby.
    await host.goto(inviteUrl);
    await host.waitForURL(/\/lobby\?code=/, { timeout: 5000 });
    await expect(host.locator('#players-container')).toContainText('Alice (you)');
  } finally {
    await cleanupRoom(host, roomCode);
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
