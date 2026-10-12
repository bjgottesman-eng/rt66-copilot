import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfigBundle } from '../bundle.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'config');
mkdirSync(outDir, { recursive: true });
for (const [file, content] of Object.entries(buildConfigBundle())) {
  writeFileSync(join(outDir, file), JSON.stringify(content, null, 2) + '\n');
}
console.log(`shared-config: wrote ${Object.keys(buildConfigBundle()).length} files to ${outDir}`);
