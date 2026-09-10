import { existsSync, mkdirSync, symlinkSync, readFileSync, rmSync, lstatSync, globSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(process.argv[2] || '');
// 0.1.5-rc.1 marker: the external `tools/dshx` builder is gone and the client
// bundle contract now lives in the workspace tsdown preset.
if (!process.argv[2] || !existsSync(join(root, 'packages/client/tsdown.client.ts'))) throw new Error('Pass a prepared Harness checkout.');
const local = resolve('node_modules');
mkdirSync(local, { recursive: true });
const shared = {
  '@deepseek-ai/cordis': 'vendor/cordis',
  '@deepseek-ai/dsh-session-stats': 'packages/session/session-stats',
  '@deepseek-ai/dsh-api-session-controller': 'packages/api/session-controller',
  '@deepseek-ai/dsh-api-remotes': 'packages/api/remotes',
  '@deepseek-ai/dsh-session-turn-outline': 'packages/session/session-turn-outline',
  '@deepseek-ai/dsh-client-store': 'packages/client/store',
  '@deepseek-ai/dsh-client-ui-chat': 'packages/client/ui-chat',
  '@deepseek-ai/dsh-client-ui-conversation': 'packages/client/ui-conversation',
  '@deepseek-ai/dsh-client-ui-primitives': 'packages/client/ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer': 'packages/client/ui-renderer',
  '@deepseek-ai/dsh-client-ui-session': 'packages/client/ui-session',
  '@deepseek-ai/dsh-client-ui-slots': 'packages/client/ui-slots',
  '@deepseek-ai/dsh-attachment': 'packages/attachment/attachment',
  '@deepseek-ai/dsh-session': 'packages/core/session',
  '@deepseek-ai/dsh-session-projection': 'packages/session/session-projection',
  '@deepseek-ai/dsh-client-ui-settings': 'packages/client/ui-settings',
  '@deepseek-ai/dsh-util-workspace-path': 'packages/util/workspace-path',
};
function link(name, target) {
  if (!existsSync(target)) throw new Error(`Missing Harness dependency target: ${name} (${target})`);
  const destination = join(local, name);
  mkdirSync(dirname(destination), { recursive: true });
  if (lstatSync(destination, { throwIfNoEntry: false })) {
    try { rmSync(destination, { recursive: true, force: true }); } catch {}
  }
  symlinkSync(target, destination);
}
for (const [name, path] of Object.entries(shared)) link(name, join(root, path));
const require = createRequire(join(root, 'packages/client/ui-conversation/package.json'));
const rootRequire = createRequire(join(root, 'package.json'));
for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom']) link(name, dirname(require.resolve(`${name}/package.json`)));
for (const name of ['@types/node', 'typescript', 'tsdown', 'tsx']) link(name, dirname(rootRequire.resolve(`${name}/package.json`)));
// lightningcss declares no "./package.json" subpath, so link it by directory.
link('lightningcss', join(root, 'node_modules/lightningcss'));
// Runtime dependency of the Host half. The workspace copy lives in the pnpm
// store (no root symlink, because no root package depends on it), so take it
// from the store directory by name.
const zodManifest = globSync(join(root, 'node_modules/.pnpm/zod@*/node_modules/zod/package.json'))[0];
if (zodManifest === undefined) throw new Error('Missing Harness dependency target: zod');
link('zod', dirname(zodManifest));
for (const name of ['@types/mdast', 'clsx', 'katex', 'mdast-util-from-markdown', 'mdast-util-gfm', 'mdast-util-math', 'micromark-core-commonmark', 'micromark-extension-gfm', 'micromark-extension-math', 'micromark-factory-space', 'micromark-util-character', 'micromark-util-classify-character', 'micromark-util-sanitize-uri', 'micromark-util-symbol', 'micromark-util-types']) {
  link(name, join(root, 'packages/client/ui-primitives/node_modules', name));
}
mkdirSync(join(local, '.bin'), { recursive: true });
for (const name of ['typescript', 'tsdown']) {
  const pkg = JSON.parse(readFileSync(join(local, name, 'package.json'), 'utf8'));
  const bins = typeof pkg.bin === 'string' ? { [name]: pkg.bin } : pkg.bin;
  for (const [command, path] of Object.entries(bins)) {
    const target = join(local, '.bin', command);
    if (!existsSync(target)) symlinkSync(join(local, name, path), target);
  }
}
console.log('Development dependencies linked to the selected Harness; no package download or Harness mutation.');
