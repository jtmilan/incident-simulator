import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const entry = expectedSha ? `./?v=${expectedSha}` : './';

const blockingViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} [${v.nodes.map((n) => n.target.join(' ')).join(', ')}]`);

const tourCard = (page: Page) => page.locator('.tour-card');
const consoleTour = (page: Page) => page.getByRole('button', { name: 'Tour', exact: true });

test('the guided tour tells the whole story on the live simulation', async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  await page.mouse.move(700, 450); // CPU WebGL in headless Chromium: the scene loads on engagement

  await page.getByRole('button', { name: '90-second tour' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console', { timeout: 3_000 });
  await expect(page).toHaveURL(/#tour$/);
  const meet = page.getByRole('dialog', { name: 'Meet checkout-api' });
  await expect(meet).toBeVisible();
  await expect(meet).toContainText('1 / 6');
  await expect(meet.getByRole('heading', { name: 'Meet checkout-api' })).toBeFocused();
  await expect(page.locator('.tour-spot')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('tour-1-meet.png') });
  expect(await blockingViolations(page)).toEqual([]);

  // Step 2 runs the kill itself; 5× keeps the test short (the tour starts at 1×).
  await meet.getByRole('button', { name: 'Next' }).click();
  const kill = page.getByRole('dialog', { name: /kill a pod/ });
  await expect(kill).toContainText('2 / 6');
  await expect(kill.getByRole('heading')).toBeFocused();
  const chaos = page.getByRole('complementary', { name: 'Chaos experiments' });
  await chaos.getByRole('button', { name: '5×' }).click();
  await expect(kill.getByRole('status')).toContainText('Healed in', { timeout: 10_000 });
  const postmortem = page.getByRole('region', { name: 'Postmortem' });
  await expect(postmortem).toContainText('not paged (self-healed)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('tour-2-healed.png') });

  // Step 3 injects 5xx and moves on by itself once the page fires.
  await kill.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: /requests fail/ })).toBeVisible();
  await expect(postmortem).toBeHidden(); // a new incident retires the last postmortem
  const paged = page.getByRole('dialog', { name: 'Paged: HighErrorBudgetBurn' });
  await expect(paged).toBeVisible({ timeout: 15_000 });
  await expect(paged.getByRole('heading')).toBeFocused();
  await expect(page.getByTestId('status')).toContainText('PAGING');
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('tour-4-paged.png') });

  await paged.getByRole('button', { name: 'Next' }).click();
  const recover = page.getByRole('dialog', { name: 'Mitigate: recover all' });
  await expect(recover.getByRole('status')).toContainText(/paged after \d+ s, recovered in \d+ s/, { timeout: 15_000 });
  await expect(postmortem).toContainText('HighErrorBudgetBurn');
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('tour-5-postmortem.png') });

  // Back and forth never re-runs an experiment; a met step stays met.
  await recover.getByRole('button', { name: 'Back' }).click();
  await expect(paged).toBeVisible();
  await paged.getByRole('button', { name: 'Next' }).click();
  await expect(recover.getByRole('status')).toContainText('recovered in');
  await expect(page.getByRole('region', { name: 'Incident timeline' }).getByText(/^Injected 20% HTTP 5xx/)).toHaveCount(1);

  await recover.getByRole('button', { name: 'Next' }).click();
  const yours = page.getByRole('dialog', { name: 'Your turn' });
  await expect(yours).toContainText('6 / 6');
  expect(await blockingViolations(page)).toEqual([]);
  await yours.getByRole('button', { name: 'Finish' }).click();
  await expect(tourCard(page)).toHaveCount(0);
  await expect(page.locator('.tour-spot')).toHaveCount(0);
  await expect(page).toHaveURL(/#console$/);
  await expect(consoleTour(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test('#tour deep link starts the tour; Esc and Skip end it and hand focus back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${entry}#tour`);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console');
  const card = page.getByRole('dialog', { name: 'Meet checkout-api' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(tourCard(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#console$/);
  await expect(consoleTour(page)).toBeFocused();

  // Start from the console; paused motion is called out instead of looking stuck.
  await consoleTour(page).click();
  await expect(page).toHaveURL(/#tour$/);
  await page.getByRole('complementary', { name: 'Chaos experiments' }).getByRole('button', { name: 'Pause motion' }).click();
  await page.getByRole('dialog', { name: 'Meet checkout-api' }).getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: /kill a pod/ }).getByRole('status')).toContainText('Motion is paused');
  await page.getByRole('complementary', { name: 'Chaos experiments' }).getByRole('button', { name: 'Pause motion' }).click();

  // Restarting a running tour keeps the #tour URL; then Skip.
  await consoleTour(page).click();
  await expect(page).toHaveURL(/#tour$/);
  await expect(page.getByRole('dialog', { name: 'Meet checkout-api' })).toContainText('1 / 6');
  await page.getByRole('dialog', { name: 'Meet checkout-api' }).getByRole('button', { name: 'Skip tour' }).click();
  await expect(tourCard(page)).toHaveCount(0);
  await expect(consoleTour(page)).toBeFocused();

  // Esc inside a "real config" dialog closes that dialog, not the tour.
  await consoleTour(page).click();
  await page.getByRole('complementary', { name: 'Service health' }).locator('[data-config="slo"]').click();
  await expect(page.getByRole('dialog', { name: /SLO: multi-window/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /SLO: multi-window/ })).toBeHidden();
  await expect(tourCard(page)).toHaveCount(1);
});

test('#scenario= links run their experiment once; unknown names run nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const chaos = page.getByRole('complementary', { name: 'Chaos experiments' });
  const timeline = page.getByRole('region', { name: 'Incident timeline' });

  await page.goto(`${entry}#scenario=rm-rf`);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console');
  await page.waitForTimeout(2_500);
  await expect(chaos.locator('.action[data-status="running"]')).toHaveCount(0);
  await expect(timeline.locator('.row-source', { hasText: 'chaos' })).toHaveCount(0);

  // Same page, new hash (fires popstate and hashchange): still exactly one run.
  await page.evaluate(() => (window.location.hash = '#scenario=error-burst'));
  await expect(chaos.getByRole('button', { name: /Inject 5xx errors/ })).toHaveAttribute('data-status', 'running', { timeout: 5_000 });
  await expect(page).toHaveURL(/#console$/);
  await page.waitForTimeout(1_000);
  await expect(timeline.getByText(/^Injected 20% HTTP 5xx/)).toHaveCount(1);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the tour switches to the tab that holds each target and keeps its card on screen', async ({ page }, testInfo) => {
    await page.goto(entry);
    await page.getByRole('button', { name: '90-second tour' }).click();
    await expect(page.getByRole('dialog', { name: 'Meet checkout-api' })).toBeVisible({ timeout: 3_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3 points at the error budget, which lives in the Health tab.
    await expect(page.getByRole('dialog', { name: /requests fail/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Health' })).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(800);
    const card = (await tourCard(page).boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(390);
    expect(card.y + card.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('tour-mobile.png') });
    await page.keyboard.press('Escape');
    await expect(tourCard(page)).toHaveCount(0);
  });
});

test('360px phone: the console header keeps Tour and Overview on screen without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`${entry}#console`);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console');
  for (const name of ['Tour', '← Overview']) {
    const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.x + box.width, name).toBeLessThanOrEqual(360);
  }
  expect(await page.locator('.console').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test('reduced motion: a still frame instead of the orbiting light', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${entry}#tour`);
  await expect(page.locator('.tour-spot')).toBeVisible();
  const animation = await page.locator('.tour-spot').evaluate((el) => getComputedStyle(el, '::before').animationName);
  expect(animation).toBe('none');
});

test('hero: infra map and the large footer, with the live status', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(entry);
  const infra = page.getByRole('region', { name: 'How this maps to real infrastructure' });
  await expect(infra).toContainText('HorizontalPodAutoscaler');
  await expect(infra).toContainText('CloudNativePG');
  await expect(infra).toContainText('Argo CD');
  const footer = page.locator('.site-footer');
  await expect(footer.locator('[data-footer-status]')).toContainText('all systems normal');
  await expect(footer.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', 'https://github.com/jtmilan/chaos-control-room');
  await footer.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('hero-full.png'), fullPage: true });

  // The footer's tour link is a deep link like any other.
  await footer.getByRole('link', { name: 'Take the tour' }).click();
  await expect(page.getByRole('dialog', { name: 'Meet checkout-api' })).toBeVisible({ timeout: 3_000 });
  expect(await blockingViolations(page)).toEqual([]);
});
