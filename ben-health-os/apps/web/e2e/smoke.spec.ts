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

  // Trends with 7/28/90/365-day windows
  await page.goto('/trends?metric=hrv_rmssd&days=90');
  await expect(page.getByTestId('trend-chart')).toBeVisible();
  await expect(page.getByTestId('trend-windows')).toContainText('365 days');

  // Domain dashboard
  await page.goto('/domains/recovery');
  await expect(page.getByText('Open in Trends').first()).toBeVisible();
  await page.screenshot({ path: '../../screenshots/web-domain-recovery.png', fullPage: true });
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

  // Nutrition + glucose (Phase 4): demo data includes a Cronometer CSV import and Stelo glucose
  await page.goto('/nutrition');
  await expect(page.getByTestId('nutrition-days')).toContainText('cronometer');
  await expect(page.getByTestId('glucose-chart')).toBeVisible();
  await expect(page.getByTestId('glucose-stats')).toContainText('mg/dL');
  await page.getByTestId('csv-text').fill('Day,Group,Food Name,Amount,Energy (kcal),Protein (g)\n2026-01-15,Lunch,Lentil soup,1 bowl,320,18\n');
  await page.getByTestId('csv-review').click();
  await expect(page.getByTestId('csv-mapping')).toContainText('SERVINGS');
  await page.getByTestId('csv-import').click();
  await expect(page.getByTestId('csv-result')).toContainText('1 inserted');
  await page.getByTestId('annotation-label').fill('Evening walk');
  await page.getByTestId('annotation-save').click();
  await expect(page.getByText('Evening walk').first()).toBeVisible();
  await page.screenshot({ path: '../../screenshots/web-nutrition.png', fullPage: true });

  // Labs (Phase 5): paste a lab CSV, review, stage, confirm, see the explorer
  await page.goto('/labs');
  await page.getByTestId('lab-csv-text').fill('Test,Value,Unit,Reference Range,Flag,Collected\nApolipoprotein B,78,mg/dL,< 90,,2026-09-20\nLDL Cholesterol,112,mg/dL,< 100,H,2026-09-20\n');
  await page.getByTestId('lab-review').click();
  await expect(page.getByTestId('lab-mapping')).toContainText('2 result rows');
  await page.getByTestId('lab-import').click();
  await expect(page.getByTestId('lab-import-result')).toContainText('2 row(s) staged');
  await expect(page.getByTestId('lab-queue')).toBeVisible();
  await page.getByTestId('lab-confirm-selected').click();
  await expect(page.getByTestId('labs-analytes')).toContainText('ApoB');
  await expect(page.getByTestId('labs-analytes')).toContainText('LDL-C');
  await page.screenshot({ path: '../../screenshots/web-labs.png', fullPage: true });

  // Preventive care: add from a template; medications: add one; physician brief: generate a PDF
  await page.goto('/preventive');
  await page.getByTestId('template-physical').click();
  await page.getByTestId('prev-save').click();
  await expect(page.getByTestId('prev-list')).toContainText('Annual physical');
  await page.goto('/medications');
  await page.getByTestId('med-name').fill('Atorvastatin');
  await page.getByTestId('med-save').click();
  await expect(page.getByTestId('med-list')).toContainText('Atorvastatin');
  await page.goto('/physician-brief');
  await page.getByTestId('brief-reason').fill('Annual visit');
  await page.getByTestId('brief-generate').click();
  await expect(page.getByTestId('brief-result')).toContainText('Open PDF');

  // Honest placeholders
  await page.goto('/health-ceo');
  await expect(page.getByText('Not implemented')).toBeVisible();

  // Settings + export link
  await page.goto('/settings');
  await expect(page.getByTestId('export-all')).toBeVisible();
});
