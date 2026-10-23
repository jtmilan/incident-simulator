import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const expectedSha = process.env.EXPECTED_SHA?.trim().toLowerCase();
const consoleEntry = expectedSha ? `./?v=${expectedSha}#console` : './#console';

test('the console runs the whole story: kill, page, recover, postmortem', async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(consoleEntry);
  await page.mouse.move(700, 450);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'console');

  const chaos = page.getByRole('complementary', { name: 'Chaos experiments' });
  const health = page.getByRole('complementary', { name: 'Service health' });
  const timeline = page.getByRole('region', { name: 'Incident timeline' });
  await expect(chaos.getByRole('button', { name: /Kill a pod/ })).toBeEnabled();
  await expect(health).toContainText('SLO 99.9% · window 30d → 1h (demo)');
  await expect(health).toContainText('3 ready / 3 desired');

  await chaos.getByRole('button', { name: '5×' }).click();
  await expect(chaos.getByRole('button', { name: '5×' })).toHaveAttribute('aria-pressed', 'true');

  // Break: kill a pod, it self-heals.
  await chaos.getByRole('button', { name: /Kill a pod/ }).click();
  await expect(timeline).toContainText('Deleted pod/checkout-api-');
  await expect(page.locator('.caption').first()).toBeVisible();
  await expect(timeline).toContainText('Ready (readiness probe passed)', { timeout: 6_000 });

  // Escalate: 20% errors page within seconds at 5×.
  await chaos.getByRole('button', { name: /Inject 5xx errors/ }).click();
  await expect(chaos.getByRole('button', { name: /Inject 5xx errors/ })).toBeDisabled();
  await expect(page.getByTestId('status')).toContainText('PAGING', { timeout: 10_000 });
  await expect(health.locator('.alert[data-state="firing"]')).toContainText('HighErrorBudgetBurn');
  await page.screenshot({ path: testInfo.outputPath('console-paging.png') });

  // Resolve: recover, then the postmortem appears.
  await chaos.getByRole('button', { name: 'Recover all' }).click();
  const postmortem = page.getByRole('region', { name: 'Postmortem' });
  await expect(postmortem).toBeVisible({ timeout: 20_000 });
  await expect(postmortem).toContainText('Time to detect');
  await expect(postmortem).toContainText('HighErrorBudgetBurn');
  await page.screenshot({ path: testInfo.outputPath('console-postmortem.png') });

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test('"real config" opens the production manifests and returns focus on Esc', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(consoleEntry);
  const opener = page.getByRole('complementary', { name: 'Service health' }).locator('[data-config="slo"]');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /SLO: multi-window, multi-burn-rate alerting/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('slo:sli_error:ratio_rate1h > (14.4 * 0.001)');
  await expect(dialog).toContainText('severity: page');

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await page.getByRole('complementary', { name: 'Chaos experiments' }).locator('[data-config="workload"]').click();
  await expect(page.getByRole('dialog')).toContainText('initialDelaySeconds: 3');
  await expect(page.getByRole('dialog')).toContainText('stabilizationWindowSeconds: 300');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('complementary', { name: 'Service health' }).locator('[data-config="database"]').click();
  await expect(page.getByRole('dialog')).toContainText('failoverDelay: 0');
});
