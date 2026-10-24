import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const entry = expectedSha ? `./?v=${expectedSha}&debug` : './?debug';

const blockingViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} [${v.nodes.map((n) => n.target.join(' ')).join(', ')}]`);
const sceneScroll = (page: Page) => page.evaluate(() => (window as unknown as { __ccr: { sceneScroll: () => number | null } }).__ccr.sceneScroll());
const ringTransform = (page: Page) => page.locator('.boot-ring svg').evaluate((el) => (el as SVGElement).style.transform);
const engineLoaded = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ccr: { motion: () => { loaded: boolean } } }).__ccr.motion().loaded);

const scrollTo = async (page: Page, y: number) => {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
};

test('scrolling the hero orbits the camera and turns the dial, and scrolling back restores them', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await page.mouse.move(700, 450); // CPU WebGL in headless Chromium: the scene loads on engagement
  await expect.poll(() => engineLoaded(page)).toBe(true);
  await expect.poll(() => sceneScroll(page), { timeout: 15_000 }).not.toBeNull();
  expect(await sceneScroll(page)).toBeLessThan(0.02);

  await scrollTo(page, 700);
  await expect.poll(() => sceneScroll(page), { timeout: 5_000 }).toBeGreaterThan(0.2);
  await expect.poll(() => ringTransform(page)).toMatch(/rotate\((?!0\.00deg)[\d.]+deg\)/);

  await scrollTo(page, 0);
  await expect.poll(() => sceneScroll(page), { timeout: 6_000 }).toBeLessThan(0.02);
  await expect.poll(() => ringTransform(page)).toMatch(/rotate\(0\.\d+deg\)|rotate\(0deg\)/);
});

test('infra and footer reveal once, end in place, and keep their accessible names', async ({ page }) => {
  // A short window, so the infra heading starts below the fold and has something to reveal.
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(entry);
  await expect.poll(() => engineLoaded(page)).toBe(true);
  const heading = page.getByRole('heading', { name: 'How this maps to real infrastructure' });
  await expect(heading).toHaveAttribute('aria-label', 'How this maps to real infrastructure');
  await expect(heading.locator('.ch')).toHaveCount('Howthismapstorealinfrastructure'.length);
  await expect(page.locator('.infra-field span')).toHaveCount(84);

  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_800);
  // Every letter and row ends where the static page would have it: no transform left behind.
  expect(await heading.locator('.ch').evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.transform !== '').length)).toBe(0);
  expect(await page.locator('.infra-row').evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.transform !== '').length)).toBe(0);
  expect(await blockingViolations(page)).toEqual([]);

  const wordmark = page.locator('.wordmark');
  await wordmark.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_600);
  await expect(wordmark.locator('.ch')).toHaveCount('incident-simulator'.length);
  expect(await wordmark.locator('.ch').evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.transform !== '').length)).toBe(0);
  await expect(wordmark).toHaveAttribute('aria-hidden', 'true');
  expect(await blockingViolations(page)).toEqual([]);
});

test('text already on screen when the story loads stays put; the new replica field still ripples in', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await expect.poll(() => engineLoaded(page)).toBe(true);
  const heading = page.getByRole('heading', { name: 'How this maps to real infrastructure' });
  await expect(heading).toBeInViewport();
  await expect(heading.locator('.ch')).toHaveCount(0); // visible at load: left whole, never jumps
  await expect(page.locator('.infra-field span')).toHaveCount(84);
  await expect.poll(() => page.locator('.infra-field span').last().evaluate((el) => (el as HTMLElement).style.transform), { timeout: 4_000 }).toBe('');
});

test('reduced motion: nothing scroll-linked, headings left whole', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await expect.poll(() => engineLoaded(page)).toBe(true);
  await scrollTo(page, 700);
  await page.waitForTimeout(800);
  expect(await ringTransform(page)).toBe('');
  await expect(page.locator('.infra h2 .ch')).toHaveCount(0);
  await expect(page.locator('.infra-field')).toHaveCount(0);
});

test('without the motion chunk every section is complete', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route(/\/(engine|story)-[\w-]+\.js$/, (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await scrollTo(page, 99_999);
  await expect(page.getByRole('heading', { name: 'How this maps to real infrastructure' })).toBeVisible();
  await expect(page.locator('.infra-row')).toHaveCount(6);
  await expect(page.locator('.wordmark')).toHaveText('incident-simulator');
  expect(errors).toEqual([]);
});

test('360px: the story adds no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(entry);
  await expect.poll(() => engineLoaded(page)).toBe(true);
  for (const y of [0, 900, 99_999]) {
    await scrollTo(page, y);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
});
