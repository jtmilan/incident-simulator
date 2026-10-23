import { expect, test } from '@playwright/test';

// Drives the real simulator in a browser through the ?debug console.
const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const withDebug = expectedSha ? `./?v=${expectedSha}&debug` : './?debug';
const withoutDebug = expectedSha ? `./?v=${expectedSha}` : './';

test('the debug console runs the simulator: a killed pod is replaced and becomes Ready', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));

  await page.goto(withDebug);
  await expect(page.getByTestId('debug-view')).toBeVisible();
  for (const id of ['killPod', 'injectErrors', 'trafficSurge', 'injectLatency', 'failoverDatabase', 'recoverAll', 'speed-1', 'speed-5', 'reset']) {
    await expect(page.getByTestId(`cmd-${id}`)).toBeVisible();
  }

  await page.getByTestId('cmd-speed-5').click();
  await page.getByTestId('cmd-killPod').click();

  const timeline = page.getByTestId('debug-timeline');
  await expect(timeline).toContainText('Deleted pod/checkout-api-', { timeout: 3_000 });
  await expect(timeline).toContainText('Ready (readiness probe passed)', { timeout: 6_000 });
  await expect(page.getByTestId('debug-clock')).toContainText('speed 5×');
  expect(errors).toEqual([]);
});

test('normal visitors never download the debug console', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (req) => requested.push(req.url()));
  await page.goto(withoutDebug);
  await page.waitForLoadState('networkidle');

  expect(requested.some((url) => url.includes('debug-view'))).toBe(false);
  await expect(page.getByTestId('debug-view')).toHaveCount(0);
});
