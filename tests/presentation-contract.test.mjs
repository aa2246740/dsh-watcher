import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientSource = new URL('../src/client/Watcher.tsx', import.meta.url)
const clientStyles = new URL('../src/client/Watcher.module.css', import.meta.url)
const performanceSource = new URL('../src/observation/performance.ts', import.meta.url)
const modelTraceSource = new URL('../src/observation/model-trace.ts', import.meta.url)
const modelDefinitionSource = new URL('../src/client/model-trace-definition.ts', import.meta.url)
const clientIndexSource = new URL('../src/client/index.tsx', import.meta.url)
const overviewSource = new URL('../src/hub/overview.ts', import.meta.url)
const packageSource = new URL('../package.json', import.meta.url)

test('text results use the official semantic reader while raw evidence stays exact', async () => {
  const source = await readFile(clientSource, 'utf8')

  assert.match(source, /<MarkdownText text=\{presentation\.text\}/)
  assert.match(source, /data-watcher-document=""/)
  assert.doesNotMatch(source, /<pre className=\{css\.textResult\}>/)
  assert.match(source, /<pre>\{raw \|\| '没有原始数据'\}<\/pre>/)
  assert.match(source, /<CopyRawButton text=\{raw\} \/>/)
})

test('the Markdown reader is supplied through the declared RC8 client injection', async () => {
  const pkg = JSON.parse(await readFile(packageSource, 'utf8'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-primitives'], '^0.1.0-rc.8')
})

test('the overview keeps every Step and occurrence reachable through folding and reversible grouping', async () => {
  const [source, styles] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /className=\{css\.turnToggle\}/)
  assert.match(source, /aria-expanded=\{turnOpen\}/)
  assert.match(source, /className=\{css\.turnOverviewToggle\}/)
  assert.match(source, />\s*轮次概览\s*<\/button>/)
  assert.match(source, /新进展保持收起/)
  assert.match(source, /className=\{css\.phaseMarker\}/)
  assert.match(source, /className=\{css\.phaseToggle\}/)
  assert.match(source, /data-overview-state=\{phaseState\}/)
  assert.match(source, /className=\{css\.overviewStep\}/)
  assert.match(source, /className=\{css\.stepToggle\}/)
  assert.match(source, /step\.items\.map/)
  assert.match(source, /className=\{css\.overviewOccurrence\}/)
  assert.match(source, /clusterWorkItems\(group\.items\.filter\(item => item\.source !== 'model'\)\)/)
  assert.match(source, /className=\{css\.analysisClusterToggle\}/)
  assert.match(source, /onSelectItem=\{item => selectItem\(group, item\)\}/)
  assert.match(source, />\s*逐项\s*<\/button>/)
  assert.match(source, />\s*归类\s*<\/button>/)
  assert.match(source, /aria-label="返回工作路径"/)
  assert.match(source, /picture\.stepCount/)
  assert.doesNotMatch(source, /<StatusMark status=\{turn\.status\}/)
  assert.doesNotMatch(source, /className=\{css\.groupDot\}/)
  assert.doesNotMatch(source, /<span>现在<\/span>/)

  assert.match(styles, /\.phaseMarker\[data-state='settled'\]|\.phaseMarker\s*\{/)
  assert.match(styles, /\.phaseMarker\[data-state='partial'\]/)
  assert.match(styles, /\.overviewOccurrenceTitle\s*\{[^}]*font-size:\s*14px/s)
  assert.match(styles, /\.phaseToggle\[aria-expanded='true'\] \.phaseChevron/)
  assert.match(styles, /\.turnOverviewToggle\[data-active\]/)
  assert.match(styles, /\.stepToggle\[aria-expanded='true'\] \.stepChevron/)
  assert.match(styles, /\.analysisClusterToggle\[aria-expanded='true'\] \.analysisClusterChevron/)
  assert.match(styles, /@keyframes watcher-live-append/)
  assert.match(styles, /\.menu:not\(:has\(\.inspector\)\)/)
  assert.match(styles, /\.menu:has\(\.inspector\) \.workPicture\s*\{\s*display:\s*none;/)
  assert.doesNotMatch(styles, /max-height:\s*48vh/)
  assert.doesNotMatch(styles, /\.groupDot|\.nowTag/)
})

test('opening a partial first window automatically restores every earlier conversation Turn', async () => {
  const [source, styles] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /正在补齐历史/)
  assert.match(source, /snapshot\.hasMore/)
  assert.match(source, /if \(!open \|\| !snapshot\.hasMore \|\| historyLoad\.kind !== 'idle'\) return/)
  assert.match(source, /startHistoryLoad\(\)/)
  assert.doesNotMatch(source, /载入全部轮次/)
  assert.match(styles, /\.historyNotice\s*\{/)
})

test('wall-clock evidence is visible at every useful level without heuristic speed', async () => {
  const [source, styles, performance, overview] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
    readFile(performanceSource, 'utf8'),
    readFile(overviewSource, 'utf8'),
  ])

  assert.match(source, /`对话轮次 \$\{turn\.turn\}`/)
  assert.match(source, /总耗时/)
  assert.match(source, /已记录/)
  assert.match(source, /开头未载入/)
  assert.doesNotMatch(source, /≥/)
  assert.match(source, /会话总跨度/)
  assert.match(source, /轮次内耗时/)
  assert.match(source, /轮次间隔/)
  assert.match(source, /首 token/)
  assert.match(source, /tok\/s/)
  assert.doesNotMatch(source, /回合/)
  assert.doesNotMatch(source, /需要处理/)
  assert.doesNotMatch(overview, /需要处理/)
  assert.match(overview, /有失败记录/)
  assert.match(styles, /\.turnMetrics\s*\{/)
  assert.match(styles, /\.sessionTiming\s*\{/)
  assert.match(styles, /\.stepDuration\s*\{/)
  assert.match(styles, /\.occurrenceDuration\s*\{/)
  assert.match(styles, /grid-template-columns:\s*repeat\(3,/)
  assert.match(performance, /firstTokenTime/)
  assert.match(performance, /outputTokens \/ \(fold\.decodeMs \/ 1000\)/)
})

test('each Step can disclose a truthful nested model stage and provider-visible reasoning', async () => {
  const [source, styles, modelTrace, modelDefinition, clientIndex] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
    readFile(modelTraceSource, 'utf8'),
    readFile(modelDefinitionSource, 'utf8'),
    readFile(clientIndexSource, 'utf8'),
  ])

  assert.match(source, /function ModelStage/)
  assert.match(source, /模型阶段/)
  assert.match(source, /首响应等待/)
  assert.match(source, /可见推理/)
  assert.match(source, /输出 \/ 工具意图/)
  assert.match(source, /分段耗时不可用/)
  assert.match(source, /aria-expanded=\{open\}/)
  assert.match(source, /<MarkdownText text=\{attempt\.reasoningText\}/)
  assert.match(source, /\[modelKey\]: true/)
  assert.match(styles, /\.modelStage\s*\{/)
  assert.match(styles, /\.modelStageBar\s*\{/)
  assert.match(styles, /\.reasoningDisclosure\s*\{/)
  assert.match(modelTrace, /reasoningTokens/)
  assert.match(modelTrace, /reasoning-delta/)
  assert.match(modelDefinition, /buildLocationData/)
  assert.match(modelDefinition, /key: 'dsh-watcher-model-stage'/)
  assert.match(clientIndex, /'conversationEvents'/)
  assert.match(clientIndex, /registerModelTraceDefinition\(ctx\)/)
  assert.doesNotMatch(source, /隐藏思维/)
})
