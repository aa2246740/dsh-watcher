import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'vitest'
import ts from 'typescript'
import vm from 'node:vm'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Context } from '@deepseek-ai/cordis'

/**
 * React 18's client renderer reads `window` and `document` while committing.
 * The suite runs in Node, so the host objects below exist only for this file.
 * `HTMLIFrameElement` has to be a function: the commit path uses `instanceof`.
 */
function installHostDom() {
  class HTMLElement {}
  class HTMLIFrameElement extends HTMLElement {}
  globalThis.HTMLElement = HTMLElement
  globalThis.HTMLIFrameElement = HTMLIFrameElement
  globalThis.Node = class Node {}
  globalThis.window = globalThis

  function make(tag) {
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      nodeName: String(tag).toUpperCase(),
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      style: { setProperty() {}, getPropertyValue() { return '' } },
      childNodes: [],
      attributes: new Map(),
      parentNode: null,
      ownerDocument: null,
      textContent: '',
      className: '',
      dataset: {},
      scrollLeft: 0,
      scrollTop: 0,
      get firstChild() { return el.childNodes[0] ?? null },
      get lastChild() { return el.childNodes.at(-1) ?? null },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child)
        child.parentNode = el
        el.childNodes.push(child)
        return child
      },
      removeChild(child) {
        const index = el.childNodes.indexOf(child)
        if (index >= 0) el.childNodes.splice(index, 1)
        child.parentNode = null
        return child
      },
      insertBefore(child, ref) {
        if (child.parentNode) child.parentNode.removeChild(child)
        const index = ref == null ? -1 : el.childNodes.indexOf(ref)
        if (index < 0) el.childNodes.push(child)
        else el.childNodes.splice(index, 0, child)
        child.parentNode = el
        return child
      },
      contains(node) {
        if (node === el) return true
        return el.childNodes.some(child => child === node || child.contains?.(node))
      },
      setAttribute(name, value) { el.attributes.set(name, String(value)) },
      getAttribute(name) { return el.attributes.has(name) ? el.attributes.get(name) : null },
      removeAttribute(name) { el.attributes.delete(name) },
      hasAttribute(name) { return el.attributes.has(name) },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
    }
    el.ownerDocument = document
    return el
  }

  const document = {
    nodeType: 9,
    documentElement: null,
    head: null,
    body: null,
    activeElement: null,
    createElement: make,
    createElementNS: (_namespace, tag) => make(tag),
    createTextNode(text) {
      return {
        nodeType: 3,
        nodeValue: String(text),
        textContent: String(text),
        data: String(text),
        parentNode: null,
        ownerDocument: document,
      }
    },
    querySelector() { return null },
    addEventListener() {},
    removeEventListener() {},
  }
  document.documentElement = make('html')
  document.head = make('head')
  document.body = make('body')
  document.documentElement.appendChild(document.head)
  document.documentElement.appendChild(document.body)
  globalThis.document = document
  return document
}

const document = installHostDom()

function loadModule(file, requireMap = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const exports = {}
  const requireFn = (name) => {
    if (name in requireMap) return requireMap[name]
    throw new Error(`sidebar cordis test did not expect require(${name})`)
  }
  vm.runInNewContext(code, { exports, require: requireFn })
  return exports
}

const logCalls = []
const log = { calls: logCalls, logDebug(message) { logCalls.push(String(message)) } }
const loaderCalls = []
const history = loadModule('../src/client/history-loader.ts', {
  '../hub/history.ts': loadModule('../src/hub/history.ts'),
})
const sidebar = loadModule('../src/client/SidebarTab.tsx', {
  react: React,
  'react/jsx-runtime': await import('react/jsx-runtime'),
  '../log.ts': log,
  './Watcher.module.css': { sidebarHost: 'sidebarHost' },
  './Watcher.tsx': {
    WorkPicturePanel: () => null,
    useObservedPicture: () => ({ picture: {}, performanceByTurn: new Map() }),
  },
  './history-loader.ts': {
    createCompleteHistoryLoader(...args) {
      loaderCalls.push(args)
      return history.createCompleteHistoryLoader(...args)
    },
  },
})

function observable(value) {
  const listeners = new Set()
  return {
    listeners,
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function sessionServices(sessionId) {
  const chat = {
    legacy: { nodes: [{ seq: 1 }], turnTimings: [], runningCalls: [] },
    timeline: { turnOrder: [1] },
  }
  const sessionListeners = new Set()
  const sessionSnapshot = { blank: false, running: false, hasMore: false, loadingOlder: false }
  const face = {
    getSnapshot: () => sessionSnapshot,
    subscribe(listener) {
      sessionListeners.add(listener)
      return () => sessionListeners.delete(listener)
    },
    loadOlder: async () => {},
    projections: { faceOf: () => undefined },
  }
  const conversation = observable({ views: new Map([['chat', chat]]) })
  const status = observable(new Map())
  return {
    sessionListeners,
    conversation,
    status,
    sessions: {
      binding(id) {
        return id === sessionId ? { session: face } : undefined
      },
    },
    uiConversation: {
      binding(id) {
        if (id !== sessionId) throw new Error('binding is not current')
        return { snapshot: conversation }
      },
    },
    uiSession: { sessionStatus: status },
  }
}

function attribute(node, name) {
  if (node != null && typeof node.getAttribute === 'function') {
    const value = node.getAttribute(name)
    if (value != null) return value
  }
  for (const child of node?.childNodes ?? []) {
    const value = attribute(child, name)
    if (value != null) return value
  }
  return null
}

function listenerCount(services) {
  return services.sessionListeners.size + services.conversation.listeners.size + services.status.listeners.size
}

async function renderOnCordis(hostInject) {
  const sessionId = 'session-1'
  const services = sessionServices(sessionId)
  const root = new Context()
  root.provide('slots', {})
  root.provide('sessions', services.sessions)
  root.provide('uiConversation', services.uiConversation)
  root.provide('uiSession', services.uiSession)
  root.provide('betterSidebar', { registerTab: () => () => {} })
  let watcherCtx
  let hostCtx
  const watcher = await root.plugin({
    name: 'dsh-watcher-client',
    inject: ['slots', 'sessions', 'uiConversation', 'uiSession'],
    apply(ctx) {
      ctx.inject(['betterSidebar'], child => { watcherCtx = child })
    },
  })
  const host = await root.plugin({
    name: 'better-sidebar-render',
    inject: hostInject,
    apply(ctx) { hostCtx = ctx },
  })
  assert.ok(watcherCtx, 'watcher fiber did not inject betterSidebar')
  assert.ok(hostCtx, 'better sidebar render fiber did not start')
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const reactRoot = createRoot(mount)
  const before = loaderCalls.length
  try {
    const element = sidebar.watcherSidebarDescriptor(watcherCtx).component({
      ctx: hostCtx,
      scope: { sessionId },
      visible: true,
    })
    flushSync(() => reactRoot.render(element))
    assert.equal(attribute(mount, 'data-watcher-sidebar'), 'picture', hostInject.join(','))
    assert.ok(listenerCount(services) > 0, 'ready tab did not subscribe to session stores')
    const call = loaderCalls[before]
    assert.equal(call[0], services.uiConversation)
    assert.equal(call[1], sessionId)
    assert.equal(call[0].fiber, undefined)
  } finally {
    flushSync(() => reactRoot.unmount())
    mount.parentNode?.removeChild(mount)
    await watcher.dispose()
    await host.dispose()
    await root.fiber.dispose()
  }
  assert.equal(listenerCount(services), 0)
}

test('a real Cordis watcher fiber and a separate sidebar render fiber reach the ready picture', async () => {
  const logCount = log.calls.length
  await renderOnCordis(['slots'])
  await renderOnCordis(['slots', 'sessions', 'uiConversation', 'uiSession'])
  assert.deepEqual(log.calls.slice(logCount), [])
  assert.ok(log.calls.every(message => !message.includes('cannot set property "uiConversation" in multiple fibers')))
})
