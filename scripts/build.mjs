import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('lib', {recursive:true});
await build({entryPoints:['src/dsh-watcher.ts'],outfile:'lib/dsh-watcher.js',bundle:true,platform:'node',format:'esm',target:'node22',external:['@deepseek-ai/*'],sourcemap:true});
const browser = await build({entryPoints:['src/client/index.tsx'],outfile:'lib/client.js',bundle:true,platform:'browser',format:'cjs',target:'es2022',jsx:'automatic',write:false,external:['react','react-dom','react/jsx-runtime','@deepseek-ai/*']});
const js = browser.outputFiles.find(f=>f.path.endsWith('.js'))?.text;
const css = browser.outputFiles.find(f=>f.path.endsWith('.css'))?.text ?? '';
if (!js) throw new Error('Missing browser bundle');
// esbuild exports getters: return a new object instead of assigning a read-only apply.
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:"dsh-watcher",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${js}\nconst original=module.exports;return {...original,apply:function(ctx,...args){ctx.effect(()=>{const style=document.createElement('style');style.dataset.watcherInsights='';style.textContent=${JSON.stringify(css)};document.head.append(style);return()=>style.remove();},'watcher styles');return original.apply(ctx,...args);}};}});\n`);
