import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { dirname, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * External client build for DeepSeek Harness 0.1.5-rc.1.
 *
 * The pre-0.1.5 route was `tools/dshx/src/client-build.js` (the `dshx`
 * external adapter), which no longer exists in the Harness checkout. The
 * contract it implemented still does, and now lives in the workspace preset
 * `packages/client/tsdown.client.ts`; that preset resolves its package
 * manifest by globbing the Harness's own `packages/*​/*`, so an out-of-repo
 * plugin cannot call it. This file restates the two artifact contracts the
 * Harness actually consumes, reading them from the Harness itself wherever a
 * value is shared:
 *
 * 1. Node half (`lib/dsh-watcher.js`): ESM loaded by the Host Loader. Real
 *    production dependencies stay imports; everything else inlines.
 * 2. Client half (`lib/client.js`): a closure-factory CJS artifact registered
 *    through `window.__ModuleLoader__.load({id, factory})`, resolving only
 *    module-table specifiers through the injected `require`. Anything else
 *    under `@deepseek-ai/` is a hard build error (cross-plugin value imports
 *    cannot be answered by the module table).
 */

const root = process.env.DSHX_HARNESS
if (!root) throw new Error('Set DSHX_HARNESS to the checkout used for this build.')
const HARNESS_ROOT = resolvePath(root)
if (!existsSync(resolvePath(HARNESS_ROOT, 'packages/client/tsdown.client.ts'))) {
  throw new Error(`DSHX_HARNESS does not look like a 0.1.5-rc.1 Harness checkout: ${HARNESS_ROOT}`)
}

/** Package manifest of this plugin; the build reads its own `dsh.client` declaration. */
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  name: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dsh?: { client?: { external?: unknown } }
}
const ID = manifest.name

/**
 * Module-table specifiers the shell seeds before any plugin bundle runs. Read
 * from the Harness so this list cannot drift from the boot seed.
 */
const { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS } = await import(
  pathToFileURL(resolvePath(HARNESS_ROOT, 'packages/client/web/src/platform.ts')).href
) as {
  PLATFORM_MODULES: readonly string[]
  PRELOADED_CLIENT_EXTERNALS: readonly string[]
}

/** `dsh.client.external` extras (validated the same way the host validates the wire field). */
function declaredExternals(): readonly string[] {
  const value = manifest.dsh?.client?.external
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${ID}: dsh.client.external must be a string array`)
  }
  return value as string[]
}

const CLIENT_EXTERNALS = new Set([...PLATFORM_MODULES, ...PRELOADED_CLIENT_EXTERNALS, ...declaredExternals()])

/** Browser-safe wire layers a client bundle may inline (mirrors the Harness preset's list). */
const INLINE_SAFE = /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-agent-presets\/display$|@deepseek-ai\/dsh-spill-policy\/notice$)/
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const TYPES_MARKER = `${sep}lib${sep}types${sep}`
const SOURCE_MARKER = `${sep}src${sep}`
const SOURCEMAP_COMMENT = /\n\/\/# sourceMappingURL=.*\s*$/

/**
 * The plugin's own directory, taken from this file rather than the invoking
 * cwd. Virtual module ids are spelled relative to it: rolldown labels every
 * module with a `//#region` comment, and a `\0`-prefixed id is emitted verbatim,
 * so an absolute path there would publish the build machine's directory layout
 * inside the shipped bundle.
 */
const PROJECT_ROOT = fileURLToPath(new URL('.', import.meta.url))

/** Virtual id for one CSS Modules file, project-relative and therefore portable. */
function cssVirtualId(fileId: string): string {
  return CSS_VIRTUAL_PREFIX + relative(PROJECT_ROOT, fileId) + CSS_VIRTUAL_SUFFIX
}

/** Emit one plugin-owned style injector plus its CSS Modules class map. */
function styleInjectionModule(id: string, fileId: string, css: string, classMap: Record<string, string>): string {
  const tagId = `${id}/${fileId.slice(fileId.lastIndexOf(sep) + 1)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

/** Resolve an emitted asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

/** Chain tsc's emitted maps into the client bundle so browser frames reach the TSX. */
function tscSourceMapPlugin() {
  return {
    name: 'dsh-tsc-sourcemap',
    async load(id: string) {
      if (!id.includes(TYPES_MARKER) || !id.endsWith('.js') || !existsSync(`${id}.map`)) return null
      const code = await readFile(id, 'utf8')
      const mapPath = `${id}.map`
      const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
        sourceRoot?: unknown
        sources?: unknown
        sourcesContent?: unknown
        [key: string]: unknown
      }
      if (!Array.isArray(map.sources) || map.sources.some(source => typeof source !== 'string')) {
        throw new Error(`client sourcemap: ${mapPath} has invalid sources`)
      }
      const sources = map.sources as string[]
      if (
        !Array.isArray(map.sourcesContent)
        || map.sourcesContent.length !== sources.length
        || map.sourcesContent.some(source => typeof source !== 'string')
      ) {
        const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : ''
        map.sourcesContent = await Promise.all(sources.map(async source =>
          await readFile(resolvePath(dirname(mapPath), sourceRoot, source), 'utf8')))
      }
      return { code: code.replace(SOURCEMAP_COMMENT, ''), map }
    },
  }
}

/** The plugin's own production dependencies stay imports in the Node half. */
const productionExternals = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
  ...Object.keys(manifest.optionalDependencies ?? {}),
].map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`))

/** Node half: loaded by the Host Loader from a real install. */
const hostHalf: UserConfig = {
  name: ID,
  entry: ['src/dsh-watcher.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: (specifier: string) => productionExternals.some(pattern => pattern.test(specifier)),
    alwaysBundle: (specifier: string) =>
      !isBuiltin(specifier) && !productionExternals.some(pattern => pattern.test(specifier)),
  },
}

/** Client half: the browser closure-factory artifact served from the plugin route. */
const clientHalf: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
    alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
  },
  inputOptions: {
    resolve: {
      conditionNames: [
        (process.env.NODE_ENV ?? 'production') === 'development' ? 'development' : 'production',
        'browser', 'import', 'module', 'default',
      ],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    // Belt and braces for the rule stated on {@link PROJECT_ROOT}: ids are
    // project-relative already, but a build invoked from another cwd makes
    // rolldown label ordinary modules with their absolute path.
    name: 'dsh-portable-region-labels',
    renderChunk(code: string) {
      if (!code.includes(PROJECT_ROOT)) return null
      return code.replace(/\/\/#region [^\n]*/g, label => label.split(PROJECT_ROOT).join('.'))
    },
  }, {
    // Bundle purity gate: only module-table requests may stay external, only
    // inline-safe wire layers may inline; every other @deepseek-ai value import
    // is a build error.
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.has(source)) return null
      if (VENDORED_LIBRARY.test(source)) return null
      if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not in the platform seed or ${ID}'s dsh.client.external, `
        + 'an inline-safe wire layer, or a generated /remote contribution — '
        + 'cross-plugin value imports are forbidden; declare a module request or collaborate through cordis services '
        + '(type-only imports are erased and never reach this gate)',
      )
    },
  }, tscSourceMapPlugin(), {
    // Ordered BEFORE the source-tree fallback: a CSS Modules import must reach
    // the virtual-id swap, because the fallback would otherwise resolve it to
    // the real `.css` file and tsdown's css-guard rejects that id.
    name: 'dsh-css-modules-inline',
    resolveId: {
      order: 'pre' as const,
      handler(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return cssVirtualId(abs)
      },
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = resolvePath(PROJECT_ROOT, virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length))
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
        classMap[local] = exp.name
      }
      return styleInjectionModule(ID, fileId, code.toString(), classMap)
    },
  }, {
    // tsc emits only TS/TSX, so a relative import of a plain `.mjs` helper
    // (kept as one source of truth for the node tests) resolves inside
    // `lib/types/**` to nothing. Retry it against the mirroring `src/**` path.
    name: 'dsh-src-tree-fallback',
    resolveId: {
      order: 'pre' as const,
      handler(source: string, importer: string | undefined) {
        if (importer === undefined || !source.startsWith('.')) return null
        if (!importer.includes(TYPES_MARKER)) return null
        const emitted = resolvePath(dirname(importer), source)
        if (existsSync(emitted)) return null
        const boundary = emitted.indexOf(TYPES_MARKER)
        if (boundary < 0) return null
        const fromSource = resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
        return existsSync(fromSource) ? fromSource : null
      },
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [hostHalf, clientHalf]
