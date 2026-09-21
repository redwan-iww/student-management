// Copies the generated model types into the widget source tree.
//
// The widget never owns field names -- they come from schema/model.yaml via
// `npm run gen:types`. Keeping src/generated/ a copy rather than an import
// means the app compiles against a checked-in file and cannot silently drift
// from the schema: regenerate, and any rename breaks the build at the call site.

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'build', 'types.ts');
const dest = join(root, 'src', 'generated', 'types.ts');

if (!existsSync(src)) {
  console.error(`missing ${src}\nRun \`npm run gen:types\` first.`);
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('synced build/types.ts -> src/generated/types.ts');
