// Visual review: renders every major screen and material option to screenshots/ (headless Chromium, software WebGL).
import { test, expect, type Page } from '@playwright/test';

const dir = 'screenshots';
test.describe.configure({ mode: 'serial' });

async function labReady(page: Page) {
  await page.waitForFunction(() => (window as any).__labReady === true, null, { timeout: 120_000 });
  await page.evaluate(() => { const s = (window as any).__lab; s.rig.snap(); s.requestRender(); });
  await page.waitForTimeout(1500);
}

test('menus and settings', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/01-main-menu.png` });
  await page.getByTestId('menu-play').click();
  await page.screenshot({ path: `${dir}/02-play-menu.png` });
  await page.getByTestId('mode-custom').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/03-custom-setup.png` });
  await page.goto('./');
  await page.getByTestId('menu-settings').click();
  for (const t of ['gameplay', 'look', 'anim', 'audio', 'access', 'coach', 'data', 'about']) {
    await page.getByTestId(`tab-${t}`).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/04-settings-${t}.png` });
  }
  for (const [route, name] of [['stats', '05-stats'], ['achievements', '06-achievements'], ['howto', '07-howto'], ['training', '08-training'], ['history', '09-history']] as const) {
    await page.evaluate((r) => (window as any).__nav(r), route);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
});

test('material lab: woods, wear, shapes', async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.evaluate(() => (window as any).__nav('lab'));
  await labReady(page);
  await page.screenshot({ path: `${dir}/10-lab-walnut-light.png` });
  for (const [label, file] of [['Oak', 'oak'], ['Mahogany', 'mahogany'], ['Ebony', 'ebony']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(500);
    await labReady(page);
    await page.screenshot({ path: `${dir}/11-lab-${file}.png` });
  }
  await page.getByRole('button', { name: 'Vintage', exact: true }).click();
  await labReady(page);
  await page.screenshot({ path: `${dir}/12-lab-vintage.png` });
  for (const [label, file] of [['Round', 'round'], ['Rect', 'rect']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(500);
    await labReady(page);
    await page.screenshot({ path: `${dir}/13-lab-${file}.png` });
  }
  await page.getByRole('button', { name: 'Oval', exact: true }).click();
  await page.getByRole('button', { name: 'Walnut', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByTestId('tab-cards').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/14-lab-cards.png` });
  await page.getByTestId('tab-chips').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${dir}/15-lab-chips.png` });
  await page.getByTestId('tab-textures').click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${dir}/16-lab-textures.png`, fullPage: true });
});

test('game in landscape and portrait', async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.evaluate(() => ((window as any).__speedOverride = 0));
  await page.getByTestId('menu-play').click();
  await page.getByTestId('mode-quick').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await page.locator('[data-testid="act-check"], [data-testid="act-call"]').first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/20-game-turn.png` });
  await page.getByTestId('act-raise').click().catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/21-game-bet-panel.png` });
  await page.getByTestId('bet-cancel').click().catch(() => {});
  // play on (always call) until a showdown happens or a few hands pass
  for (let i = 0; i < 80; i++) {
    const shown = await page.evaluate(() => (window as any).__game.ctrl.hand?.events.some((e: any) => e.t === 'show'));
    if (shown) break;
    if (await page.getByTestId('rebuy').isVisible().catch(() => false)) await page.getByTestId('rebuy').click();
    // sane test player: check when free, call small bets, otherwise fold
    await page.evaluate(() => {
      const c = (window as any).__game.ctrl;
      const v = c.view.get();
      if (!v.human) return;
      const L = v.human.legal;
      if (L.canCheck) c.act({ type: 'check' });
      else if (L.callAmount <= v.human.stack * 0.12) c.act({ type: 'call' });
      else c.act({ type: 'fold' });
    });
    await page.waitForTimeout(700);
  }
  if (await page.getByTestId('rebuy').isVisible().catch(() => false)) await page.getByTestId('rebuy').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/22-game-showdown.png` });
  await page.getByTestId('pause').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/23-game-pause.png` });
  await page.getByTestId('resume').click();
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/24-game-portrait.png` });
});
