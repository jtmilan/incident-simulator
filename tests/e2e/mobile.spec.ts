import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const entry = expectedSha ? `./?v=${expectedSha}` : './';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('phone: hero fits, console is tabbed under the 3D view', async ({ page }, testInfo) => {
  await page.goto(entry);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('mobile-hero.png') });

  await page.getByRole('button', { name: /Enter the control room/ }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console', { timeout: 3_000 });

  const tabs = page.getByRole('tablist', { name: 'Console panels' });
  await expect(tabs).toBeVisible();
  const chaosTab = tabs.getByRole('tab', { name: 'Chaos' });
  await expect(chaosTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Chaos' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Service health' })).toBeHidden();

  await chaosTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Health' })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: 'Health' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Health' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel', { name: 'Timeline' })).toBeVisible();

  await tabs.getByRole('tab', { name: 'Chaos' }).click();
  const kill = page.getByRole('button', { name: /Kill a pod/ });
  expect((await kill.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('mobile-console.png') });

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('reduced motion: no pulsing chips or animated captions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${entry}#console`);
  const names = await page.evaluate(() => {
    const probe = (cls: string) => {
      const el = document.createElement('p');
      el.className = cls;
      document.body.append(el);
      const name = getComputedStyle(el).animationName;
      el.remove();
      return name;
    };
    return [probe('caption')];
  });
  expect(names).toEqual(['none']);
});
