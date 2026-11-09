import { test, expect } from '@playwright/test';
import { guardNetwork, waitForServiceWorker } from './helpers';

test('app installs, then works fully offline (menu, deal, play a hand)', async ({ page, context }) => {
  const external = guardNetwork(context);
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('pageerror', (e) => failed.push('pageerror: ' + e.message));

  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await waitForServiceWorker(page);
  // Reload once so the page is controlled by the SW (as after first install on iPad).
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('offline-badge-menu')).toBeVisible();

  // ---- go offline ----
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible();

  // About shows offline ready + cached files
  await page.getByTestId('menu-about').click();
  await expect(page.getByTestId('offline-ready')).toBeVisible();
  await expect(page.getByTestId('cache-count')).not.toHaveText('…');
  await page.getByRole('button', { name: 'Back' }).click();

  // Start a quick game and play a hand (instant animations: software WebGL in CI is slow)
  await page.evaluate(() => ((window as any).__speedOverride = 0));
  await page.getByTestId('menu-play').click();
  await page.getByTestId('mode-quick').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await expect(page.getByTestId('table-canvas')).toBeVisible();
  // Wait until it's the human's turn or the hand completes; act with check/call/fold until one hand finishes.
  await page.waitForFunction(() => (window as any).__game?.handsCompleted >= 0, null, { timeout: 60_000 });
  const start = await page.evaluate(() => (window as any).__game.handsCompleted);
  for (let i = 0; i < 120; i++) {
    const done = await page.evaluate((s) => (window as any).__game.handsCompleted > s, start);
    if (done) break;
    const btn = page.locator('[data-testid="act-check"]:not([disabled]), [data-testid="act-call"]:not([disabled])').first();
    if (await btn.isVisible().catch(() => false)) await btn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  expect(await page.evaluate((s) => (window as any).__game.handsCompleted > s, start)).toBe(true);

  // Fully reload offline again: resume works
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('menu-continue')).toBeVisible();

  expect(external, 'no request may leave the device').toEqual([]);
  expect(failed.filter((f) => f.startsWith('pageerror'))).toEqual([]);
});
