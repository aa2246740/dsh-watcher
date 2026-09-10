import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

// Explicit opt-in, read-only acceptance against an existing Host. No prompts,
// sessions, or Hosts are created. DSH_TEST_URL may carry the startup token;
// never print it or save browser traces/storage state.
const { DSH_TEST_URL: url, DSH_TEST_WORKSPACE: workspace, DSH_TEST_SESSION: title } = process.env
assert.ok(url && workspace && title, 'Set DSH_TEST_URL, DSH_TEST_WORKSPACE and DSH_TEST_SESSION')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Local Host only')
const { launchPinnedChromium } = await import(pathToFileURL(`${homedir()}/.codex/playwright-runtime/runtime.mjs`).href)
const browser = await launchPinnedChromium()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => { if (/dsh-watcher/.test(error.message)) errors.push(error.message) })
  await page.goto(url)
  await page.waitForFunction(() => globalThis.__ModuleLoader__?.mode === 'live')
  await page.getByRole('treeitem', { name: workspace, exact: true }).click()
  await page.getByText(title, { exact: true }).first().click()
  await page.getByRole('button', { name: /Watcher/ }).waitFor()
  await page.reload()
  await page.waitForFunction(() => globalThis.__ModuleLoader__?.mode === 'live')
  await page.getByRole('button', { name: /Watcher/ }).click({ timeout: 10000 })
  await page.getByRole('dialog', { name: 'Watcher 工作图' }).waitFor()
  assert.deepEqual(errors, [], 'Restored sessions must not trip the header slot error boundary')
  console.log('PASS: Watcher survives selected-session restoration and opens its work graph')
} finally {
  await browser.close()
}
