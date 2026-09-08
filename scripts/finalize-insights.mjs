// Idempotent adjustments made after the baseline source migration.
import { readFileSync, writeFileSync } from 'node:fs';
function edit(path, change) { const before=readFileSync(path,'utf8'); const after=change(before); if(before!==after)writeFileSync(path,after); }
edit('package.json',text=>{const p=JSON.parse(text);p.scripts.build='node scripts/apply-insights-patch.mjs && node scripts/finalize-insights.mjs && tsc -p tsconfig.json && node scripts/build.mjs';p.scripts.typecheck='node scripts/apply-insights-patch.mjs && node scripts/finalize-insights.mjs && tsc -p tsconfig.json --noEmit';p.scripts.test='node scripts/apply-insights-patch.mjs && node scripts/finalize-insights.mjs && tsc -p tsconfig.json && node --test tests/*.test.mjs';p.scripts['test:insights']='node --test tests/insights.test.mjs';return JSON.stringify(p,null,2)+'\n';});
edit('src/client/Insights.tsx',text=>text
 .replace('范围：当前 Host 可列出的普通会话，统计完整自有日志，排除 fork 继承前缀。未读取、失败和直接子代理不计为零。压缩、标题等独立辅助调用暂不计入。','范围：当前 Host 已载入会话的投影与历史缓存；不自动激活冷会话。旧会话尚无缓存时，手动打开一次后再刷新。缓存可能滞后，未纳入数据不计作零；直接子代理、标题和压缩调用暂不计入。')
 .replace('只读、本地、无额外模型调用。Watcher 不保存第二份推理或工具正文；统计由 DSH 日志重建。聚合页不会为了扫描而启动任务。','只读、本地、无额外模型调用。报表只读取列表中已提供的统计，不调用可能激活历史会话的 follow 接口。旧缓存覆盖范围明确显示；统计不新存正文。')
 .replace("<strong>{duration(stats.modelMs ?? 0)}</strong>","<strong>{stats.timedCalls ? duration(stats.modelMs ?? 0) : '未记录'}</strong>"));
edit('src/client/Insights.module.css',text=>text.replaceAll('--dsw-text-primary','--dsw-alias-label-primary').replaceAll('--dsw-border','--dsw-alias-border-l2').replaceAll('--dsw-accent','--dsw-static-deepseek-450').replaceAll('--dsw-bg-secondary','--dsw-alias-interactive-bg-hover'));
edit('tests/presentation-contract.test.mjs',text=>text
 .replace('opening a partial first window automatically restores every earlier conversation Turn','partial history stays explicitly loadable without blocking Host summary')
 .replace('assert.match(source, /startHistoryLoad\\(\\)/)', 'assert.match(source, /onClick=\\{startHistoryLoad\\}/)'));
