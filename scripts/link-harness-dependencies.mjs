import { existsSync, mkdirSync, symlinkSync, readFileSync, readdirSync, realpathSync, rmSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const supplied = process.env.DSH_REPO || process.argv[2];
const root = resolve(supplied || '');
if (!supplied || !existsSync(join(root, 'tools/dshx/src/client-build.js'))) throw new Error('Set DSH_REPO or pass a prepared Harness checkout.');
const local = resolve('node_modules');
mkdirSync(local, { recursive: true });
const shared = {
  '@deepseek-ai/cordis': 'vendor/cordis',
  '@deepseek-ai/dsh-session-stats': 'packages/session/session-stats',
  '@deepseek-ai/dsh-api-session-controller': 'packages/api/session-controller',
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
function packageEntry(dir) {
  if (!existsSync(join(dir, 'package.json'))) return undefined;
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const exp = manifest.exports?.['.'];
  const entry = exp?.import ?? exp?.default ?? (typeof exp === 'string' ? exp : undefined) ?? manifest.main;
  if (typeof entry === 'string' && !existsSync(join(dir, entry))) return undefined;
  return dir;
}
function runtimePackage(name) {
  const direct = packageEntry(join(root, 'node_modules', name));
  if (direct) return direct;
  let modules = join(root, 'node_modules');
  if (existsSync(join(root, 'node_modules/@deepseek-ai'))) {
    try { modules = dirname(realpathSync(join(root, 'node_modules/@deepseek-ai'))); } catch {}
  }
  const ignored = packageEntry(join(modules, '.ignored', name));
  if (ignored) return ignored;
  const store = join(modules, '.pnpm');
  if (!existsSync(store)) return undefined;
  const slug = name.replace('/', '+') + '@';
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith(slug)) continue;
    const found = packageEntry(join(store, entry, 'node_modules', name));
    if (found) return found;
  }
  return undefined;
}
function link(name, target) {
  const built = packageEntry(target) ?? runtimePackage(name);
  if (!built) throw new Error(`Missing Harness dependency target: ${name} (${target})`);
  target = built;
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
function resolvePackage(resolver, name) {
  try { return dirname(resolver.resolve(`${name}/package.json`)); }
  catch { return undefined; }
}
function linkIfPresent(name, target) {
  if (!target || !existsSync(target)) {
    console.log(`Kept installed ${name}; this Harness checkout does not ship it.`);
    return;
  }
  link(name, target);
}
for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom']) linkIfPresent(name, resolvePackage(require, name) ?? resolvePackage(rootRequire, name));
for (const name of ['@types/node', 'typescript', 'tsdown', 'tsx']) linkIfPresent(name, resolvePackage(rootRequire, name));
for (const name of ['@types/mdast', 'clsx', 'katex', 'mdast-util-from-markdown', 'mdast-util-gfm', 'mdast-util-math', 'micromark-core-commonmark', 'micromark-extension-gfm', 'micromark-extension-math', 'micromark-factory-space', 'micromark-util-character', 'micromark-util-classify-character', 'micromark-util-sanitize-uri', 'micromark-util-symbol', 'micromark-util-types']) {
  linkIfPresent(name, join(root, 'packages/client/ui-primitives/node_modules', name));
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
