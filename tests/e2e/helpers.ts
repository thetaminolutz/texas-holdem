import type { Page, BrowserContext } from '@playwright/test';

/** Record every request that leaves localhost. */
export function guardNetwork(context: BrowserContext) {
  const external: string[] = [];
  context.on('request', (req) => {
    const url = req.url();
    if (/^(data|blob|about|chrome-extension):/.test(url)) return;
    try {
      const u = new URL(url);
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') external.push(url);
    } catch {
      external.push(url);
    }
  });
  return external;
}

async function poll(page: Page, fn: () => Promise<boolean>, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn).catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  throw new Error('poll timeout');
}

export async function waitForServiceWorker(page: Page) {
  await poll(page, async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active && reg.active.state === 'activated';
  });
  await poll(page, async () => {
    let n = 0;
    for (const name of await caches.keys()) n += (await (await caches.open(name)).keys()).length;
    return n > 10;
  });
}
