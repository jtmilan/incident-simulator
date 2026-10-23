import { expect, test, type Page } from '@playwright/test';

// The 3D scene, driven through the shared simulator (exposed as window.__ccr only under ?debug).
const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const withDebug = expectedSha ? `./?v=${expectedSha}&debug` : './?debug';

type Ccr = { sim: { state: { pods: { status: string }[]; db: { phase: string } }; dispatch(c: object): void } };

const sim = (page: Page, command: object) =>
  page.evaluate((c) => (window as unknown as { __ccr: Ccr }).__ccr.sim.dispatch(c), command);

test('renders the live cluster and follows chaos in real time', async ({ page }, testInfo) => {
  test.slow(); // software WebGL in CI
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(withDebug);
  await expect(page.locator('canvas.scene')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveClass(/has-scene/);
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: testInfo.outputPath('scene-healthy.png') });

  await sim(page, { type: 'setSpeed', speed: 5 });
  await sim(page, { type: 'trafficSurge', multiplier: 3, durationMs: 120_000 });
  await page.waitForFunction(
    () => (window as unknown as { __ccr: Ccr }).__ccr.sim.state.pods.filter((p) => p.status === 'Ready').length >= 7,
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('scene-surge.png') });

  await sim(page, { type: 'failoverDatabase' });
  await page.waitForFunction(() => (window as unknown as { __ccr: Ccr }).__ccr.sim.state.db.phase === 'Promoting', null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('scene-failover.png') });

  expect(errors).toEqual([]);
});

test('keeps the page working when WebGL is unavailable', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (err) => crashes.push(err.message));
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call() below
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto(expectedSha ? `./?v=${expectedSha}` : './');
  await page.waitForTimeout(1_500);
  await expect(page.getByRole('heading', { level: 1, name: 'Chaos Control Room' })).toBeVisible();
  await expect(page.locator('canvas.scene')).toHaveCount(0);
  expect(crashes).toEqual([]);
});

test('action gallery: every chaos action has its own look', async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(withDebug);
  await expect(page.locator('body')).toHaveClass(/has-scene/, { timeout: 15_000 });
  await page.waitForTimeout(2_000);

  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`action-${name}.png`) });
  const reset = async () => {
    await sim(page, { type: 'reset' });
    await sim(page, { type: 'setSpeed', speed: 1 });
    await page.waitForTimeout(1_500);
  };

  // Kill: shards burst within the 0.42 s shatter window.
  await sim(page, { type: 'killPod' });
  await page.waitForTimeout(140);
  await shot('kill-shatter');
  await sim(page, { type: 'setSpeed', speed: 5 });
  await page.waitForTimeout(2_500);
  await shot('kill-healed');

  // 5xx at 20%: red bounces, then node edges pulse while the page fires.
  await reset();
  await sim(page, { type: 'setSpeed', speed: 5 });
  await sim(page, { type: 'injectErrors', ratio: 0.2, durationMs: 60_000 });
  await page.waitForFunction(
    () =>
      (window as unknown as { __ccr: { sim: { state: { alerts: { name: string; state: string }[] } } } }).__ccr.sim.state.alerts.some(
        (a) => a.name === 'HighErrorBudgetBurn' && a.state === 'firing',
      ),
    null,
    { timeout: 15_000 },
  );
  await sim(page, { type: 'setSpeed', speed: 1 });
  await page.waitForTimeout(600);
  await shot('errors');

  // Latency: slow, bunched traffic.
  await reset();
  await sim(page, { type: 'injectLatency', ms: 400, durationMs: 60_000 });
  await page.waitForTimeout(2_500);
  await shot('latency');

  // DB failover: writes bounce red off the dead primary.
  await reset();
  await sim(page, { type: 'failoverDatabase' });
  await page.waitForTimeout(2_500);
  await shot('failover-primary-down');

  expect(errors).toEqual([]);
});
