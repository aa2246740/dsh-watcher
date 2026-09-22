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

test('the Markdown reader is supplied through the declared RC1 client injection', async () => {
  const pkg = JSON.parse(await readFile(packageSource, 'utf8'))
  const source = await readFile(clientSource, 'utf8')
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(range, '^0.1.5-rc.3', name)
  }
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.1.5-rc.3', name)
  }
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '^4.0.2')
  assert.equal(pkg.devDependencies['@deepseek-ai/cordis'], '4.0.2')
  for (const icon of [
    'IconChevronRightOutline14',
    'IconRefreshOutline14',
    'IconCheckOutline16',
    'IconCopyOutline16',
  ]) {
    assert.match(source, new RegExp(`\\b${icon}\\b`))
    assert.match(bundle, new RegExp(`\\b${icon}\\b`))
  }
  assert.doesNotMatch(source, /OutlineRegular|OutlineMedium/)
  assert.doesNotMatch(bundle, /OutlineRegular|OutlineMedium/)
})

test('the overview keeps every Step and occurrence reachable through folding and reversible grouping', async () => {
  const [source, styles] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /className=\{css\.turnToggle\}/)
  assert.match(source, /aria-expanded=\{turnOpen\}/)
  assert.match(source, /aria-label="路径组织方式"/)
  assert.match(source, /aria-label="路径展开深度"/)
  assert.match(source, />\s*概览\s*<\/button>/)
  assert.match(source, />\s*详情\s*<\/button>/)
  assert.match(source, /layerDisclosureOpen\(disclosure, 'phase', group\.id\)/)
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
  assert.match(styles, /\.viewControl\s*\{/)
  assert.match(styles, /\.stepToggle\[aria-expanded='true'\] \.stepChevron/)
  assert.match(styles, /\.analysisClusterToggle\[aria-expanded='true'\] \.analysisClusterChevron/)
  assert.match(styles, /@keyframes watcher-live-append/)
  assert.match(styles, /\.menu:not\(:has\(\.inspector\)\)/)
  assert.match(styles, /\.menu:has\(\.inspector\) \.workPicture\s*\{\s*display:\s*none;/)
  assert.doesNotMatch(styles, /max-height:\s*48vh/)
  assert.doesNotMatch(styles, /\.groupDot|\.nowTag/)
})

test('partial history stays explicitly loadable without blocking Host summary', async () => {
  const [source, styles] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /正在补齐历史/)
  assert.match(source, /snapshot\.hasMore/)
  assert.match(source, /onClick=\{startHistoryLoad\}/)
  assert.match(source, /void loadAllHistory\(controller\.signal\)/)
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
  assert.match(source, /<SessionInsights/)
  assert.match(source, /wholeSessionInsights/)
  assert.match(source, /tok\/s/)
  assert.doesNotMatch(source, /TurnMetricStrip/)
  assert.doesNotMatch(source, /对话轮次性能分解/)
  assert.doesNotMatch(source, /回合/)
  assert.doesNotMatch(source, /需要处理/)
  assert.doesNotMatch(overview, /需要处理/)
  assert.match(overview, /有失败记录/)
  assert.doesNotMatch(styles, /\.turnMetrics\s*\{/)
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
  assert.match(source, /setLayerDisclosure\(current, 'model', modelKey, true\)/)
  assert.match(styles, /\.modelStage\s*\{/)
  assert.match(styles, /\.modelStageBar\s*\{/)
  assert.match(styles, /\.reasoningDisclosure\s*\{/)
  assert.match(modelTrace, /reasoningTokens/)
  assert.match(modelTrace, /reasoning-delta/)
  assert.match(modelDefinition, /buildLocationData/)
  assert.match(modelDefinition, /key: 'dsh-watcher-model-stage'/)
  assert.match(clientIndex, /'uiConversation'/)
  assert.match(clientIndex, /registerModelTraceDefinition\(ctx\)/)
  assert.doesNotMatch(source, /隐藏思维/)
})

test('collapsing the docked inspector animates its column instead of popping away', async () => {
  const [source, styles] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /data-closing=\{closing \? '' : undefined\}/)
  assert.match(source, /onAnimationEnd=\{closing/)
  assert.match(source, /const closeInspector = \(toLatest = false\) =>/)
  assert.match(source, /setInspectorClosing\(true\)/)
  assert.match(source, /onClick=\{selected === undefined \? backToLatest : \(\) => closeInspector\(true\)\}/)
  // Closing must not silently re-arm follow; only the "查看最新" affordance does.
  assert.match(source, /clearSelection/)
  // Animating the column changes the panel's clamped width; the frame must be
  // frozen for the transition or the whole panel flicks on every observer tick.
  assert.match(source, /const pinPanelFrame = \(\) => \{/)
  assert.match(source, /setPanelPin\(\{ top, right \}\)/)
  assert.match(source, /: \{ top: panelPin\.top, right: panelPin\.right, left: 'auto' as const \}/)
  assert.match(styles, /@keyframes watcher-inspector-enter \{\s*from \{ width: 0; \}\s*\}/)
  assert.match(styles, /@keyframes watcher-inspector-exit \{\s*to \{ width: 0; \}\s*\}/)
  assert.match(styles, /animation: watcher-inspector-exit var\(--watcher-motion-inspector\) var\(--watcher-ease-glide\) var\(--watcher-motion-content-out\)/)
  assert.match(styles, /animation: watcher-inspector-content-out var\(--watcher-motion-content-out\) ease-in forwards/)
  assert.match(styles, /@keyframes watcher-inspector-content-out \{\s*to \{ opacity: 0; transform: translateX\(16px\); \}\s*\}/)
  const reduced = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /\.inspector\[data-closing\],\s*\n\s*\.inspector\[data-closing\] > \* \{ animation-duration: \.01ms; animation-delay: 0s; \}/)
})

test('the inspector header keeps its status line inside the docked column', async () => {
  const styles = await readFile(clientStyles, 'utf8')

  // Docked children carry the column's box width; without border-box their
  // padding widened them past the column and the status tail slipped under the
  // work-path card.
  assert.match(styles, /\.inspector > \* \{\s*box-sizing: border-box;\s*width: 438px;/)
  assert.match(styles, /\.statusLine,\s*\n\.detailStatus \{\s*display: flex;\s*\n\s*flex-wrap: wrap;/)
  assert.match(styles, /\.location \{\s*margin-left: auto;\s*\n\s*min-width: 0;/)
})

test('the docked inspector keeps a visible way back to the work path', async () => {

  const [source, styles] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /className=\{css\.inspectorBack\}/)
  assert.match(source, /onClick=\{onBack\}/)
  assert.match(source, /aria-label="返回工作路径"/)

  const start = styles.indexOf('.inspectorBack {')
  const end = styles.indexOf('.inspectorBack:hover')
  assert.ok(start !== -1 && end > start, 'the docked back control has its own rule')
  const dockedRule = styles.slice(start, end)
  assert.match(dockedRule, /display: inline-flex/)
  assert.doesNotMatch(dockedRule, /display: none/)

  // Only the drill-down layout flips the chevron into a back arrow; the docked
  // layout keeps it pointing at the work path beside the inspector.
  assert.doesNotMatch(styles.slice(0, styles.indexOf('@media (max-width: 860px)')), /\.inspectorBack svg/)
})
