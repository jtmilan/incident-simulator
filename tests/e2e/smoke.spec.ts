import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The same spec runs against the local preview build and, with BASE_URL set, the live site.
// After a deploy, EXPECTED_SHA pins the check to the commit that was just pushed; the query
// string makes the CDN fetch fresh HTML instead of serving the previous deploy from cache.
const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const entry = expectedSha ? `./?v=${expectedSha}` : './';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('renders the placeholder with build provenance and a CSP', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);

  await expect(page.getByRole('heading', { level: 1, name: 'Chaos Control Room' })).toBeVisible();
  await expect(page.getByTestId('status')).toContainText('SLO 99.9% · budget 100% · all systems normal');
  await expect(page.getByText('Simulation: no real cluster runs behind this page.')).toBeVisible();

  await expect(page.getByTestId('build-sha')).toHaveText(expectedSha ? expectedSha.slice(0, 7) : /^([0-9a-f]{7}|dev)$/);
  await expect(page.getByTestId('build-run')).toHaveText(/^(#\d+|local)$/);
  await expect(page.getByTestId('repo-link')).toHaveAttribute('href', /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);

  const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(csp).toHaveCount(1);
  await expect(csp).toHaveAttribute('content', /default-src 'self'/);

  await page.screenshot({ path: testInfo.outputPath('placeholder-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto(entry);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

  expect(blocking.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('fits a 360px phone without horizontal scroll', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(entry);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('placeholder-mobile.png'), fullPage: true });
});

test('stops ambient motion when the visitor prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(entry);

  const animation = await page.locator('.glow').evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
});
