import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const entry = expectedSha ? `./?v=${expectedSha}&debug` : './?debug';

type MotionState = { loaded: boolean; paused?: boolean; active?: number; reduced?: boolean };
const motionState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ccr: { motion: () => MotionState } }).__ccr.motion());
const blockingViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} [${v.nodes.map((n) => n.target.join(' ')).join(', ')}]`);

test('the motion engine arrives after first paint, in its own chunk, and the boot ring draws in', async ({ page }) => {
  const engineRequests: string[] = [];
  page.on('request', (r) => /\/engine-[\w-]+\.js$/.test(new URL(r.url()).pathname) && engineRequests.push(r.url()));
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto(entry);
  expect(await response!.text()).not.toMatch(/engine-[\w-]+\.js/); // not preloaded by the entry HTML

  await expect.poll(() => motionState(page)).toMatchObject({ loaded: true, reduced: false });
  expect(engineRequests).toHaveLength(1);

  const ring = page.locator('.boot-ring');
  await expect(ring.locator('.boot-ticks line')).toHaveCount(120);
  await expect(ring).toHaveAttribute('data-state', 'on');
  await expect(ring).toHaveAttribute('data-level', 'ok');
  // Drawn in: the last tick reaches full opacity once the cascade finishes.
  await expect.poll(() => ring.locator('.boot-ticks line').last().evaluate((el) => getComputedStyle(el).opacity), { timeout: 4_000 }).toBe('1');
  expect(await blockingViolations(page)).toEqual([]);
});

test('budget dial: lit ticks match the % as the budget burns; only new timeline rows enter', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${entry}#console`);
  await expect.poll(() => motionState(page)).toMatchObject({ loaded: true });
  const health = page.getByRole('complementary', { name: 'Service health' });
  const chaos = page.getByRole('complementary', { name: 'Chaos experiments' });
  const ring = health.locator('.ring');
  await expect(ring.locator('.dial-tick')).toHaveCount(60);
  await expect(ring.locator('.dial-tick[data-lit="true"]')).toHaveCount(60);

  const timeline = page.getByRole('region', { name: 'Incident timeline' });
  await chaos.getByRole('button', { name: '5×' }).click();
  await chaos.getByRole('button', { name: /Inject 5xx errors/ }).click();
  await expect(timeline.locator('.row')).not.toHaveCount(0);
  const firstRow = await timeline.locator('.row').first().elementHandle();

  await expect(page.getByTestId('status')).toContainText('PAGING', { timeout: 10_000 });
  // The row drawn first is the same node, now further down: rows are keyed, never redrawn.
  expect(await firstRow.evaluate((n) => n.isConnected && n.previousElementSibling !== null)).toBe(true);

  await expect.poll(async () => {
    const pct = Number(((await ring.locator('.ring-pct').textContent()) ?? '').replace('%', ''));
    const lit = await ring.locator('.dial-tick[data-lit="true"]').count();
    return lit === Math.min(Math.max(Math.round((pct / 100) * 60), 0), 60) && pct < 100;
  }).toBe(true);
  await expect(ring).not.toHaveAttribute('data-tone', 'ok', { timeout: 10_000 });
});

test('"Pause motion" is on every view: it freezes the engine and the ring, in sync with the console button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await expect.poll(() => motionState(page)).toMatchObject({ loaded: true, paused: false });
  const stripPause = page.getByRole('banner').getByRole('button', { name: 'Pause motion' });
  await stripPause.click();
  await expect(stripPause).toHaveAttribute('aria-pressed', 'true');
  expect(await motionState(page)).toMatchObject({ paused: true });
  expect(await page.locator('.boot-ticks').evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('paused');

  await page.getByRole('button', { name: /Enter the control room/ }).click();
  const consolePause = page.getByRole('complementary', { name: 'Chaos experiments' }).getByRole('button', { name: 'Pause motion' });
  await expect(consolePause).toHaveAttribute('aria-pressed', 'true');
  await consolePause.click();
  await expect(stripPause).toHaveAttribute('aria-pressed', 'false');
  expect(await motionState(page)).toMatchObject({ paused: false });
});

test('reduced motion: nothing plays, everything sits at its end state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await expect.poll(() => motionState(page)).toMatchObject({ loaded: true, reduced: true, active: 0 });
  const ring = page.locator('.boot-ring');
  await expect(ring).toHaveAttribute('data-state', 'on');
  expect(await ring.locator('.boot-ticks line').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await page.locator('.boot-ticks').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

  await page.getByRole('button', { name: /Enter the control room/ }).click();
  await page.getByRole('complementary', { name: 'Chaos experiments' }).getByRole('button', { name: /Kill a pod/ }).click();
  expect(await motionState(page)).toMatchObject({ active: 0 });
});

test('without the motion chunk the page still works and shows end states', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route(/\/engine-[\w-]+\.js$/, (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await expect(page.locator('.boot-ring')).toHaveAttribute('data-state', 'on', { timeout: 5_000 });
  expect(await motionState(page)).toMatchObject({ loaded: false });

  await page.getByRole('button', { name: /Enter the control room/ }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console', { timeout: 3_000 });
  const chaos = page.getByRole('complementary', { name: 'Chaos experiments' });
  await chaos.getByRole('button', { name: /Kill a pod/ }).click();
  await expect(page.getByRole('region', { name: 'Incident timeline' })).toContainText('Deleted pod/checkout-api-');
  await expect(page.locator('.dial-tick[data-lit="true"]')).toHaveCount(60);
  expect(errors).toEqual([]);
});

test('phones: no boot ring, no sideways scroll, console clean', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(entry);
  await expect(page.locator('.boot-ring')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: /Enter the control room/ }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console', { timeout: 3_000 });
  await page.waitForTimeout(600);
  expect(await page.locator('.console').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
});

test('a Reset redraws the keyed timeline from scratch, even when the new one catches up', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${entry}#console`);
  const chaos = page.getByRole('complementary', { name: 'Chaos experiments' });
  const timeline = page.getByRole('region', { name: 'Incident timeline' });
  await chaos.getByRole('button', { name: '5×' }).click();
  await chaos.getByRole('button', { name: /Kill a pod/ }).click();
  await expect(timeline).toContainText('Ready (readiness probe passed)', { timeout: 6_000 });
  await chaos.getByRole('button', { name: 'Reset' }).click();
  await expect(timeline).toContainText('Scenario reset');
  await page.waitForTimeout(1_500);
  await expect(timeline).not.toContainText('Deleted pod/');
});
