// Copies the generated model types into the widget.
//
// The widget never owns field names -- they come from schema/model.yaml via
// `npm run gen:types` at the repo root. This copy keeps the widget a standalone
// npm project without letting it drift from the schema.

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'build', 'types.ts');
const dest = join(here, '..', 'src', 'generated', 'types.ts');

if (!existsSync(src)) {
  console.error(`missing ${src}\nRun \`npm run gen:types\` in the repo root first.`);
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('synced build/types.ts -> src/generated/types.ts');
