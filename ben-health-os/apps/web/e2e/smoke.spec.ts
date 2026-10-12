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

  // Health CEO (Phase 6): the demo seed generated the first weekly report with exactly three priorities and no AI without consent
  await page.goto('/health-ceo');
  await expect(page.getByTestId('report-weekly')).toBeVisible();
  await expect(page.getByTestId('priority-3')).toBeVisible();
  await expect(page.getByTestId('ai-note')).toContainText(/sharing is off|rules-based/i);
  await page.screenshot({ path: '../../screenshots/web-health-ceo.png', fullPage: true });
  await page.getByTestId('generate-monthly').click();
  await expect(page.getByTestId('report-monthly')).toBeVisible({ timeout: 60_000 });

  // Inbox: evidence is visible, dismissing moves the item to closed, alerts can be read, memory is remembered
  await page.goto('/inbox');
  const firstRec = page.getByTestId('rec-card').first();
  await firstRec.getByTestId('rec-evidence-toggle').click();
  await expect(firstRec.getByTestId('rec-evidence')).toBeVisible();
  const openBefore = await page.getByTestId('rec-list').getByTestId('rec-card').count();
  await firstRec.getByTestId('rec-dismiss').click();
  await expect(page.getByTestId('rec-list').getByTestId('rec-card')).toHaveCount(openBefore - 1);
  await page.getByTestId('alert-read').first().click();
  await page.getByTestId('memory-statement').fill('Prefers morning training sessions');
  await page.getByTestId('memory-save').click();
  await expect(page.getByTestId('memory-list')).toContainText('Prefers morning training sessions');
  await page.screenshot({ path: '../../screenshots/web-inbox.png', fullPage: true });

  // Experiments (Phase 7): the seed created one finished experiment with an honest verdict; a new one can be designed
  await page.goto('/experiments');
  await expect(page.getByTestId('experiment-card').first()).toBeVisible();
  await expect(page.getByTestId('experiment-evaluation').first()).toContainText(/Verdict/);
  await page.getByTestId('exp-title').fill('Magnesium before bed');
  await page.getByTestId('exp-question').fill('Does magnesium improve my sleep quality rating?');
  await page.getByTestId('exp-hypothesis').fill('Perceived sleep quality rises by 1 point.');
  await page.getByTestId('exp-intervention').fill('300 mg magnesium glycinate after dinner (supplement, not a prescription)');
  await page.getByTestId('exp-metric').selectOption('checkin:perceivedSleepQuality');
  await page.getByTestId('exp-save').click();
  await expect(page.getByTestId('exp-msg')).toContainText('Experiment created');
  await expect(page.getByText('Magnesium before bed')).toBeVisible();
  await page.screenshot({ path: '../../screenshots/web-experiments.png', fullPage: true });

  // Training: seeded sets and progression; log a set; save a check-in
  await page.goto('/training');
  await expect(page.getByTestId('progression-list')).toContainText('Back squat');
  await page.getByTestId('set-exercise').fill('Romanian deadlift');
  await page.getByTestId('set-load-1').fill('100');
  await page.getByTestId('set-save').click();
  await expect(page.getByTestId('set-msg')).toContainText('Saved 1 set');
  await expect(page.getByTestId('recent-sets')).toContainText('Romanian deadlift');
  await page.getByTestId('checkin-note').fill('Slept well');
  await page.getByTestId('checkin-save').click();
  await expect(page.getByTestId('checkin-msg')).toContainText('Check-in saved');
  await page.screenshot({ path: '../../screenshots/web-training.png', fullPage: true });

  // Settings + export link
  await page.goto('/settings');
  await expect(page.getByTestId('export-all')).toBeVisible();
});
