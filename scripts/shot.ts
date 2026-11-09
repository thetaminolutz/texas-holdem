// Ad-hoc screenshot helper: tsx scripts/shot.ts <url-path> <out.png> [w] [h] [waitMs] [js-to-run]
import { chromium } from 'playwright';
const [, , path = '', out = 'shot.png', w = '1180', h = '820', wait = '1500', js = ''] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:4173/' + path);
await page.waitForTimeout(+wait);
if (js) { await page.evaluate(js); await page.waitForTimeout(+wait); }
await page.screenshot({ path: out });
await browser.close();
