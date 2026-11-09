// Starts a Quick Play game in headless Chromium, plays a few actions and saves screenshots.
import { chromium } from 'playwright';
const out = process.argv[2] ?? 'shots';
const waitS = Number(process.argv[3] ?? 25);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror ' + e.message + '\n' + e.stack));
await page.goto('http://localhost:4173/');
await page.waitForTimeout(800);
await page.getByTestId('menu-play').click();
await page.getByTestId('mode-quick').click();
await page.getByTestId('start-game').click();
await page.waitForFunction(() => (window as any).__game, null, { timeout: 60000 });
const speed = Number(process.argv[4] ?? 4);
await page.evaluate((sp) => { (window as any).__game.ctrl.director.anim.speed = sp; (window as any).__speedOverride = sp; }, speed);
const t0 = Date.now();
let shot = 0;
while (Date.now() - t0 < waitS * 1000) {
  await page.waitForTimeout(2500);
  const btn = page.locator('[data-testid="act-call"], [data-testid="act-check"]').first();
  if (await btn.isVisible().catch(() => false)) {
    await page.screenshot({ path: `${out}-turn${shot}.png` });
    shot++;
    await btn.click().catch(() => {});
  }
}
await page.screenshot({ path: `${out}-end.png` });
console.log('hands completed', await page.evaluate(() => (window as any).__game?.handsCompleted));
console.log('errors', errors.slice(0, 10).join('\n'));
await browser.close();
