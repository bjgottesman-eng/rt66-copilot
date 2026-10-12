import { expect, test } from '@playwright/test';

// Requires: API on :8787 (AUTH_MODE=local, ALLOW_DEMO_SEED=true) and web on :3000.
test('login, load demo data, and walk the Phase 1 screens', async ({ page }) => {
  await page.goto('/today');
  await expect(page).toHaveURL(/\/login/);
  await page.getByTestId('login-email').fill(`e2e-${Date.now()}@example.com`);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('headline')).toBeVisible();

  // Fresh account: five domains render even with no data, and the lab metric is honestly NOT CONNECTED
  for (const d of ['recovery', 'cardio', 'strength_body', 'metabolic_nutrition', 'clinical_preventive']) await expect(page.getByTestId(`domain-${d}`)).toBeVisible();
  await expect(page.getByTestId('metric-lab_result')).toContainText(/not connected/i);

  // Load synthetic data
  await page.getByTestId('seed-demo').click();
  await expect(page.getByTestId('metric-resting_heart_rate')).toContainText(/bpm/, { timeout: 90_000 });
  await expect(page.getByTestId('metric-resting_heart_rate')).toContainText(/current|recent/i);
  await page.screenshot({ path: '../../screenshots/web-today.png', fullPage: true });

  // Trends
  await page.goto('/trends?metric=hrv_rmssd&days=90');
  await expect(page.getByTestId('trend-chart')).toBeVisible();
  await page.screenshot({ path: '../../screenshots/web-trends.png', fullPage: true });

  // Blood pressure + manual entry
  await page.goto('/trends/blood-pressure');
  await expect(page.getByTestId('bp-latest')).not.toHaveText('—');
  await page.getByTestId('bp-sys').fill('119');
  await page.getByTestId('bp-dia').fill('77');
  await page.getByTestId('bp-save').click();
  await expect(page.getByTestId('bp-msg')).toContainText(/Saved 119\/77/);

  // Data sources
  await page.goto('/sources');
  await expect(page.getByTestId('source-health_connect')).toBeVisible();
  await expect(page.getByText(/^connected$/i).first()).toBeVisible();
  await page.screenshot({ path: '../../screenshots/web-sources.png', fullPage: true });

  // Honest placeholders
  await page.goto('/labs');
  await expect(page.getByText('Not implemented')).toBeVisible();

  // Settings + export link
  await page.goto('/settings');
  await expect(page.getByTestId('export-all')).toBeVisible();
});
