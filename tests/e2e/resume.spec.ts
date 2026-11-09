import { test, expect } from '@playwright/test';

test('game resumes exactly mid-hand after the app is closed', async ({ page }) => {
  test.setTimeout(400_000);
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.evaluate(() => ((window as any).__speedOverride = 0));
  await page.getByTestId('menu-play').click();
  await page.getByTestId('mode-quick').click();
  await page.getByTestId('start-game').click();
  await page.locator('[data-testid="act-check"], [data-testid="act-call"]').first().waitFor({ timeout: 200_000 });
  const before = await page.evaluate(() => {
    const c = (window as any).__game.ctrl;
    const h = c.hand;
    return { handNo: h.init.handNo, handId: h.init.handId, hole: h.players.find((p: any) => p.id === 'human').hole, actions: c.actions.length, stacks: h.players.map((p: any) => p.stack) };
  });
  // simulate iPadOS killing the app: the page goes away without warning
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('menu-continue')).toBeVisible();
  await page.evaluate(() => ((window as any).__speedOverride = 0));
  await page.getByTestId('menu-continue').click();
  await page.locator('[data-testid="act-check"], [data-testid="act-call"]').first().waitFor({ timeout: 200_000 });
  const after = await page.evaluate(() => {
    const c = (window as any).__game.ctrl;
    const h = c.hand;
    return { handNo: h.init.handNo, handId: h.init.handId, hole: h.players.find((p: any) => p.id === 'human').hole, actions: c.actions.length, stacks: h.players.map((p: any) => p.stack) };
  });
  expect(after).toEqual(before);
});
