import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const entry = expectedSha ? `./?v=${expectedSha}` : './';
const blockingViolations = async (page: import('@playwright/test').Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help}`);

test('hero → console through the iris, labels on, then back', async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await page.mouse.move(700, 450); // CPU WebGL in headless Chromium: the scene loads on engagement

  await expect(page.getByRole('heading', { level: 1, name: 'Chaos Control Room' })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'hero');
  await expect(page.locator('body')).toHaveClass(/has-scene/, { timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: testInfo.outputPath('hero.png') });
  expect(await blockingViolations(page)).toEqual([]);

  const enter = page.getByRole('button', { name: /Enter the control room/ });
  const box = (await enter.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'opening');
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath('iris.png') });

  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console', { timeout: 3_000 });
  await expect(page.locator('#console-title')).toBeFocused();
  await expect(page).toHaveURL(/#console$/);
  const labels = page.locator('.scene-label');
  await expect(labels.filter({ hasText: 'node-a · zone a' })).toBeAttached();
  await expect(labels.filter({ hasText: 'db-1 · primary' })).toBeAttached();
  await expect(labels.filter({ hasText: 'ingress' })).toBeAttached();
  await page.waitForTimeout(1_600);
  await page.screenshot({ path: testInfo.outputPath('console.png') });
  expect(await blockingViolations(page)).toEqual([]);

  await page.getByRole('button', { name: '← Overview' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'hero', { timeout: 3_000 });
  await expect(enter).toBeFocused();
  await expect(page).not.toHaveURL(/#console/);
  expect(errors).toEqual([]);
});

test('#console deep link opens the console directly', async ({ page }) => {
  await page.goto(`${entry}#console`);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console');
  await expect(page.getByRole('region', { name: 'Control room' })).toBeVisible();
});

test('keyboard activation opens the console from the button', async ({ page }) => {
  await page.goto(entry);
  await page.getByRole('button', { name: /Enter the control room/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console', { timeout: 3_000 });
});

test('reduced motion swaps the iris for an instant switch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(entry);
  await page.getByRole('button', { name: /Enter the control room/ }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console');
});
