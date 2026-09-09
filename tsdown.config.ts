import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Builds use an explicit checkout, never an implicit production configuration.
const root = process.env.DSHX_HARNESS;
if (!root) throw new Error('Set DSHX_HARNESS to the checkout used for this build.');
const adapter = resolve(root, 'tools/dshx/src/client-build.js');
if (!existsSync(adapter)) throw new Error('DSHX externalClientBundle adapter is missing.');
const { externalClientBundle } = await import(pathToFileURL(adapter).href);
export default externalClientBundle('dsh-watcher', ['src/dsh-watcher.ts'], {
  clientEntry: 'src/client/index.tsx',
});
