import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const clientSource = new URL('../src/client/Watcher.tsx', import.meta.url)
const clientStyles = new URL('../src/client/Watcher.module.css', import.meta.url)
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

test('the overview exposes only Turn chapters and phase rows', async () => {
  const [source, styles] = await Promise.all([
    readFile(clientSource, 'utf8'),
    readFile(clientStyles, 'utf8'),
  ])

  assert.match(source, /className=\{css\.turnToggle\}/)
  assert.match(source, /aria-expanded=\{turnOpen\}/)
  assert.match(source, /className=\{css\.phaseMarker\}/)
  assert.match(source, /data-overview-state=\{phaseState\}/)
  assert.match(source, /aria-label="返回工作路径"/)
  assert.doesNotMatch(source, /picture\.stepCount/)
  assert.doesNotMatch(source, /<StatusMark status=\{turn\.status\}/)
  assert.doesNotMatch(source, /className=\{css\.groupDot\}/)

  assert.match(styles, /\.phaseMarker\[data-state='settled'\]|\.phaseMarker\s*\{/)
  assert.match(styles, /\.phaseMarker\[data-state='partial'\]/)
  assert.match(styles, /\.menu:not\(:has\(\.inspector\)\)/)
  assert.match(styles, /\.menu:has\(\.inspector\) \.workPicture\s*\{\s*display:\s*none;/)
  assert.doesNotMatch(styles, /max-height:\s*48vh/)
  assert.doesNotMatch(styles, /\.groupDot|\.nowTag/)
})
