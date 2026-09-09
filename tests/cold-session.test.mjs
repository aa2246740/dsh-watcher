import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

test('Watcher waits for chat projection, then mounts its ready child', () => {
  const source = readFileSync(new URL('../src/client/Watcher.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const exports = {}
  const jsx = (type, props) => ({ type, props })
  const react = { useMemo: fn => fn(), useRef: () => ({ current: null }), useState: value => [value, () => {}] }
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    return new Proxy({}, { get: () => () => null })
  } })
  let views = new Map()
  const props = { sessionId: 'cold', useConversation: select => select({ views }),
    useSession: select => select({}), useSessionPendingInteraction: select => select(new Map()) }
  const cold = exports.Watcher(props)
  assert.equal(cold.type, 'span')
  assert.equal(cold.props.role, 'status')
  assert.match(cold.props.children, /正在等待会话记录/)
  views = new Map([['chat', {}]])
  const ready = exports.Watcher(props)
  assert.equal(typeof ready.type, 'function')
  assert.equal(ready.props.sessionId, 'cold')
})
