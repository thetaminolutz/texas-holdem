import { test, expect } from '@playwright/test';
import { guardNetwork, waitForServiceWorker } from './helpers';

test('shell + navigation work offline from a sub-path-safe build', async ({ page, context }) => {
  const external = guardNetwork(context);
  await page.goto('./');
  await waitForServiceWorker(page);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('tab-about').click();
  await expect(page.getByTestId('offline-ready')).toBeVisible();
  // explicit index.html (as some launchers open it) is also served offline
  await page.goto('./index.html');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect(external).toEqual([]);
});
