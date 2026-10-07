import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'

const SIDEBAR_SOURCE = new URL('../src/client/SidebarTab.tsx', import.meta.url)
const INDEX_SOURCE = new URL('../src/client/index.tsx', import.meta.url)
const PACKAGE_SOURCE = new URL('../package.json', import.meta.url)

const reactStub = {
  useMemo: fn => fn(),
  useCallback: fn => fn,
  useRef: value => ({ current: value }),
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

function jsx(type, props) {
  return { type, props }
}

/** Transpile one plugin source to CJS and run it in a sandbox with fake requires. */
function loadModule(file, requireMap = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const exports = {}
  const requireFn = (name) => {
    if (name in requireMap) return requireMap[name]
    if (name === 'react') return reactStub
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    return new Proxy({}, { get: () => () => null })
  }
  vm.runInNewContext(code, { exports, require: requireFn })
  return exports
}

/**
 * Fabricate the client context surface `apply` touches: slots registration,
 * the model-trace definition store, `ctx.inject` (fires only when every
 * requested service exists), and `ctx.effect` (runs the body, returns a
 * single-shot disposer like cordis does).
 */
function fakeContext({ betterSidebar } = {}) {
  const state = {
    injectCalls: [],
    slotInjects: [],
    effectDisposers: [],
  }
  const ctx = {
    uiConversation: { events: { register() {} } },
    sessions: {},
    slots: {
      inject(name, factory) {
        state.slotInjects.push(name)
        state.lastSlotFactory = factory
      },
      register() {},
    },
    inject(names, callback) {
      state.injectCalls.push([...names])
      if (betterSidebar === undefined) return
      if (Array.isArray(names) && names.every(name => name === 'betterSidebar')) callback(ctx)
    },
    effect(execute) {
      const inner = execute()
      let done = false
      const disposer = () => {
        if (done) return
        done = true
        if (typeof inner === 'function') inner()
      }
      state.effectDisposers.push(disposer)
      return disposer
    },
  }
  if (betterSidebar !== undefined) ctx.betterSidebar = betterSidebar
  return { ctx, state }
}

function registerSpy() {
  const calls = []
  const unregisteredFlags = []
  return {
    calls,
    unregistered: () => unregisteredFlags,
    registerTab(descriptor) {
      calls.push(descriptor)
      let unregistered = false
      unregisteredFlags.push(() => unregistered)
      return () => { unregistered = true }
    },
  }
}

test('the client keeps its top-level injection surface unchanged', async () => {
  const source = readFileSync(INDEX_SOURCE, 'utf8')
  const pkg = JSON.parse(readFileSync(PACKAGE_SOURCE, 'utf8'))
  assert.match(source, /export const inject = \['slots', 'sessions', 'uiConversation'\]/)
  assert.doesNotMatch(source, /inject = \[[^\]]*betterSidebar/)
  // The optional integration stays out of the client bundle surface: no
  // value or type import of the peer anywhere in the client sources, and no
  // dependency declaration either — declaring it makes pnpm's default
  // auto-install-peers pull the whole sidebar into every dev install, so
  // integration stays runtime-detected (`ctx.inject(['betterSidebar'])`).
  for (const file of [INDEX_SOURCE, SIDEBAR_SOURCE]) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /from ['"]dsh-better-sidebar/)
    assert.doesNotMatch(text, /require\(['"]dsh-better-sidebar/)
  }
  assert.ok(!('dsh-better-sidebar' in pkg.peerDependencies))
  assert.ok(!('dsh-better-sidebar' in pkg.dependencies))
  assert.ok(!('dsh-better-sidebar' in pkg.devDependencies))
  assert.ok(!pkg.dsh.client.inject.includes('dsh-better-sidebar'))
})

test('without betterSidebar the registration is a no-op that never throws', () => {
  const sidebar = loadModule('../src/client/SidebarTab.tsx')
  const index = loadModule('../src/client/index.tsx', { './SidebarTab.tsx': sidebar })
  const { ctx, state } = fakeContext()
  assert.doesNotThrow(() => index.apply(ctx))
  assert.deepEqual(state.injectCalls, [['remote', 'remote.session'], ['betterSidebar']])
  assert.ok(state.slotInjects.includes('conversation.session.header.utilities'))
  assert.equal(state.effectDisposers.length, 0)
})

test('a betterSidebar service without registerTab is ignored', () => {
  const sidebar = loadModule('../src/client/SidebarTab.tsx')
  const index = loadModule('../src/client/index.tsx', { './SidebarTab.tsx': sidebar })
  const { ctx, state } = fakeContext({ betterSidebar: {} })
  assert.doesNotThrow(() => index.apply(ctx))
  assert.equal(state.effectDisposers.length, 0)
})

test('with registerTab the Watcher tab registers once and disposes via the effect', () => {
  const sidebar = loadModule('../src/client/SidebarTab.tsx')
  const index = loadModule('../src/client/index.tsx', { './SidebarTab.tsx': sidebar })
  const spy = registerSpy()
  const { ctx, state } = fakeContext({ betterSidebar: spy })
  assert.doesNotThrow(() => index.apply(ctx))
  assert.equal(spy.calls.length, 1)
  const descriptor = spy.calls[0]
  assert.equal(descriptor.id, 'dsh-watcher:picture')
  assert.equal(descriptor.title, 'Watcher')
  assert.equal(descriptor.single, true)
  assert.equal(descriptor.order, 80)
  assert.equal(typeof descriptor.component, 'function')
  // No file viewer, no badge: the tab is exactly the work picture.
  assert.deepEqual(Object.keys(descriptor).sort(), ['component', 'id', 'order', 'single', 'title'])
  // The disposer returned by registerTab is owned by the effect; disposing it
  // unregisters the tab and stays single-shot.
  assert.equal(state.effectDisposers.length, 1)
  const dispose = state.effectDisposers[0]
  dispose()
  assert.equal(spy.unregistered()[0](), true)
  dispose()
  assert.equal(spy.calls.length, 1)
})

test('the registered tab renders its waiting state while no session is bound', () => {
  const sidebar = loadModule('../src/client/SidebarTab.tsx')
  const descriptor = sidebar.watcherSidebarDescriptor()
  const { ctx } = fakeContext()
  const element = descriptor.component({ ctx, scope: { sessionId: 'cold' }, visible: false })
  assert.equal(element.type, sidebar.WatcherSidebarTab)
  assert.equal(element.props.sessionId, 'cold')
  assert.equal(element.props.visible, false)
  const rendered = element.type(element.props)
  assert.equal(rendered.type, 'div')
  assert.equal(rendered.props['data-watcher-sidebar'], 'waiting')
  const status = rendered.props.children
  assert.equal(status.type, 'span')
  assert.equal(status.props.role, 'status')
  assert.match(status.props.children, /正在等待会话记录/)
})
