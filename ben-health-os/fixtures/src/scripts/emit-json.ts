import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCronometerCsv, generateDemoDataset, generateLabCsv } from '../generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'demo');
mkdirSync(outDir, { recursive: true });
const ds = generateDemoDataset();
writeFileSync(join(outDir, 'health-connect-demo.json'), JSON.stringify({ generatedBy: '@bho/fixtures', options: ds.options, scenario: ds.scenario, summary: ds.summary, batches: ds.batches, manualBloodPressure: ds.manualBloodPressure }));
writeFileSync(join(outDir, 'cronometer-demo.csv'), generateCronometerCsv(ds));
writeFileSync(join(outDir, 'labs-demo.csv'), generateLabCsv(ds));
console.log(`fixtures: wrote demo dataset (${ds.summary.total_records} records, ${ds.batches.length} batches) to ${outDir}`);
