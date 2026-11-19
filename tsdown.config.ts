import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const vendored = fileURLToPath(new URL('./tools/client-build.js', import.meta.url))

function resolveHarnessAdapter() {
  const configured = process.env.DSHX_HARNESS?.trim()
  const configPath = join(homedir(), '.config/dshx/harness')
  const recorded = existsSync(configPath) ? readFileSync(configPath, 'utf8').trim() : undefined
  const selected = configured === undefined || configured.length === 0 ? recorded : configured
  if (!selected)
    throw new Error(
      'dshx client build requires a Harness root from DSHX_HARNESS or ~/.config/dshx/harness',
    )
  return join(resolve(selected), 'tools/dshx/src/client-build.js')
}

const adapter = existsSync(vendored) ? vendored : resolveHarnessAdapter()
if (!existsSync(adapter)) throw new Error(`dshx client build adapter not found: ${adapter}`)
const { externalClientBundle } = await import(pathToFileURL(adapter).href)
const [host, ...client] = externalClientBundle('dsh-watcher', ['src/dsh-watcher.ts'], {
  clientEntry: 'src/client/index.tsx',
})
// The host bundle is runtime code read by Node, not documentation: drop JSDoc
// (src/ keeps it) and keep legal and @__PURE__ comments. Saves about 0.7 kB of
// the 8 kB brotli budget in .size-limit.json.
export default [
  { ...host, outputOptions: { ...host.outputOptions, comments: { jsdoc: false } } },
  ...client,
]
