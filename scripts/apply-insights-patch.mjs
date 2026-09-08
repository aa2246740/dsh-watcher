// Idempotent source migration for this trial. CI commits the materialized source.
import { readFileSync, writeFileSync } from 'node:fs';
function patch(path, pairs, marker) {
  let text = readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`Patch anchor missing: ${path}: ${from.slice(0, 80)}`);
    text = text.replace(from, to);
  }
  writeFileSync(path, text);
}
patch('src/client/Watcher.tsx', [
  ["import css from './Watcher.module.css'", "import css from './Watcher.module.css'\nimport { SessionInsights } from './Insights.tsx'"],
  ["  const wholeSessionStats = useProjection('sessionStats')", "  const wholeSessionStats = useProjection('sessionStats')\n  const wholeSessionInsights = useProjection('watcherInsights')"],
  ['<div className={css.now} title={nowLabel}>{nowLabel}</div>', '<div className={css.now}>会话分析</div>'],
  ['<SessionTimeLedger timing={sessionTiming} />', `<SessionInsights value={wholeSessionInsights} now={now} running={picture.running} waiting={picture.pendingCount > 0} onEvidence={e => {
                pinForDisclosure()
                setDisclosure(chooseDisclosureDepth('detail'))
                requestAnimationFrame(() => document.getElementById('watcher-turn-' + e.turn)?.scrollIntoView({ block: 'nearest' }))
              }} />`],
  ["    if (!open || !snapshot.hasMore || historyLoad.kind !== 'idle') return\n    startHistoryLoad()", "    // Full history is an explicit choice. Summary comes from the Host projection.\n    if (!open || !snapshot.hasMore || historyLoad.kind !== 'idle') return"],
  ["'准备补齐历史'", "'更早路径尚未载入'"],
  ['即将自动载入更早记录', '可按需载入更早记录'],
  ["{historyLoad.kind === 'error'\n                      ? (", "{historyLoad.kind === 'error' || historyLoad.kind === 'idle'\n                      ? ("],
  ['                          重试载入', "                          {historyLoad.kind === 'error' ? '重试载入' : '载入完整路径'}"],
], 'wholeSessionInsights');
patch('src/client/index.tsx', [
  ["import { registerModelTraceDefinition } from './model-trace-definition.ts'", "import { registerModelTraceDefinition } from './model-trace-definition.ts'\nimport { InsightsSettings } from './Insights.tsx'\nimport type {} from '@deepseek-ai/dsh-client-ui-settings/client'\nimport type {} from '@deepseek-ai/dsh-api-remotes/client'"],
  ['  registerModelTraceDefinition(ctx)', `  registerModelTraceDefinition(ctx)
  ctx.inject(['remote', 'remote.session'], c => {
    c.slots.inject('settings.section', () => c.slots.register({
      name: 'settings.section', id: 'watcher-insights', order: 85,
      label: 'Watcher', inject: () => ({ remote: c.remote }),
    }, InsightsSettings))
  })`],
], 'watcher-insights');
patch('src/observation/model-trace.ts', [
  ['  readonly time: number\n}\n\nexport type ModelTraceEvent', '  readonly time: number\n  readonly lastSeq?: number\n}\n\nexport type ModelTraceEvent'],
  ["| { readonly kind: 'reasoning-delta'; readonly text: string }", "| { readonly kind: 'reasoning-delta'; readonly text: string; readonly fragments?: readonly ReasoningFragment[] }"],
  ["  if (value.type !== 'assistant/chunk'", `  // RC1 historical chunkrow envelopes preserve fragment times and sequence identities.
  if (['chunkrow/reasoning-chunks', 'chunkrow/text-chunks', 'chunkrow/tool-call-chunks'].includes(value.type)) {
    const tool = value.type === 'chunkrow/tool-call-chunks'
    const parts = tool ? data.args : data.texts
    const gaps = data.dt
    if (!Array.isArray(parts) || !parts.length || !parts.every(p => typeof p === 'string')
      || !Array.isArray(gaps) || gaps.length !== parts.length - 1 || !gaps.every(Number.isSafeInteger)) return null
    let time = location.time
    const fragments: ReasoningFragment[] = []
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) time += gaps[i - 1] as number
      if (!Number.isSafeInteger(time)) return null
      const text = parts[i] as string
      if (text !== '' || (tool && typeof data.name === 'string')) fragments.push({ seq: location.seq + i, time, text })
    }
    const first = fragments[0]
    if (!first) return null
    const base = { ...location, time: first.time, lastSeq: location.seq + parts.length - 1 }
    return value.type === 'chunkrow/reasoning-chunks'
      ? { ...base, kind: 'reasoning-delta', text: fragments.map(f => f.text).join(''), fragments }
      : { ...base, kind: 'output-delta' }
  }
  if (value.type !== 'assistant/chunk'`],
  ['Math.max(trace.lastSeq, event.seq)', 'Math.max(trace.lastSeq, event.lastSeq ?? event.seq)'],
  ['    const fragment = { seq: event.seq, time: event.time, text: event.text }', '    const fragments = event.fragments ?? [{ seq: event.seq, time: event.time, text: event.text }]'],
  ['        lastReasoningTime: event.time,', '        lastReasoningTime: fragments.at(-1)?.time ?? event.time,'],
  ['        fragments: [...attempt.fragments, fragment],', '        fragments: [...attempt.fragments, ...fragments],'],
  ["    const end = attempt.kind === 'running' && attempt.firstOutputTime === null\n      ? now\n      : attempt.lastReasoningTime", "    // An open request does not prove continuously emitted reasoning.\n    const end = attempt.lastReasoningTime"],
  ['  const outputStart = finalReasoning ?? last?.firstOutputTime ?? last?.firstTokenTime ?? null', '  const outputStart = last?.firstOutputTime ?? null'],
], 'RC1 historical chunkrow envelopes');
patch('src/observation/model-trace.ts', [
  ['    sampled = true\n    // An open request', '    if (attempt.firstOutputTime !== null && attempt.lastReasoningTime > attempt.firstOutputTime) continue // interleaved timing remains unattributed\n    sampled = true\n    // An open request'],
], 'interleaved timing remains unattributed');
// Intentional metric correction: unobserved gaps are not output or reasoning time.
patch('tests/model-trace.test.mjs', [
  ['    outputMs: 2_000,\n    unattributedMs: 0,', '    outputMs: 1_000,\n    unattributedMs: 1_000,'],
  ['    outputMs: 1_000,\n    unattributedMs: 3_000,', '    outputMs: 500,\n    unattributedMs: 3_500,'],
  ['    visibleReasoningMs: 5_000,\n    outputMs: null,\n    unattributedMs: 0,', '    visibleReasoningMs: 0,\n    outputMs: null,\n    unattributedMs: 5_000, // no content during the silence'],
], 'no content during the silence');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = '0.4.0-insights.1';
pkg.scripts = { ...pkg.scripts, build: 'node scripts/apply-insights-patch.mjs && tsc -p tsconfig.json && node scripts/build.mjs', test: 'node scripts/apply-insights-patch.mjs && tsc -p tsconfig.json && node --test tests/*.test.mjs' };
for (const name of ['@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-api-remotes']) {
  pkg.peerDependencies[name] = '^0.1.2-rc.1'; pkg.devDependencies[name] = '0.1.2-rc.1';
}
pkg.devDependencies.esbuild = '0.25.0'; pkg.devDependencies['@types/node'] = '^24.0.0';
pkg.dependencies = { ...pkg.dependencies, zod: '^4.4.3' };
pkg.dsh.client.inject = [...new Set([...pkg.dsh.client.inject, '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-api-remotes'])];
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
let readme = readFileSync('README.md','utf8').replace('`0.1.0-rc.8`','`0.1.2-rc.1`');
if (!readme.includes('INSIGHTS-TRIAL')) readme += '\n## Insights 试用分支\n\n见 [试用说明](docs/INSIGHTS-TRIAL.md)：会话摘要、设置页模型统计、只读诊断及范围限制。\n';
writeFileSync('README.md',readme);
let design = readFileSync('DESIGN.md','utf8');
if (!design.includes('Insights trial override')) design = '# Insights trial override\n\n本分支以用户的新要求为准：摘要优先，不另做 Agent 工作直播；跨会话汇总放设置。允许有来源编号的只读诊断，不自动停止、换模型或注入消息。旧文档的禁止 diagnosis 和自动全量载入历史不适用于此试用分支。正文不新建索引。\n\n' + design;
writeFileSync('DESIGN.md',design);
