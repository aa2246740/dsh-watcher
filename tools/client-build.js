// externalClientBundle — recreated from packages/client/tsdown.client.ts (public harness).
// The original lives inside DeepSeek's internal harness checkout; this file reproduces
// the emitted bundle recipe so plugins can run `npm run build` against a public clone.
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]

const CSS_VIRTUAL_PREFIX = '\0dshx-css-module:'
const INLINE_SAFE = /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-native-command\/types$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-plugin-manager\/registry$|@deepseek-ai\/dsh-agent-preset-registry\/display$|@deepseek-ai\/dsh-spill-policy\/notice$)/
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

const _require = createRequire(join(process.cwd(), 'package.json'))
let _lightningcss
async function lightning() {
  if (_lightningcss === undefined) {
    _lightningcss = await import(pathToFileURL(_require.resolve('lightningcss')).href)
  }
  return _lightningcss
}

function styleInjectionModule(id, fileId, css, classMap) {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

function pluginExternals() {
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const extras = manifest?.dsh?.client?.external ?? []
    return new Set([...PLATFORM_MODULES, ...extras])
  } catch {
    return new Set(PLATFORM_MODULES)
  }
}

function clientConfig(id, entry) {
  const externals = pluginExternals(id)
  const isRequested = (specifier) => externals.has(specifier)
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    sourcemap: true,
    clean: false,
    dts: false,
    deps: {
      neverBundle: isRequested,
      alwaysBundle: (specifier) => !isRequested(specifier),
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
      name: 'dshx-client-bundle-purity',
      resolveId(source) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (isRequested(source)) return null
        if (VENDORED_LIBRARY.test(source)) return null
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
        throw new Error(`client bundle purity: "${source}" is not in the default client externals or ${id}'s dsh.client.external — cross-plugin value imports are forbidden`)
      },
    }, {
      name: 'dshx-css-modules-inline',
      resolveId(source, importer) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined && !isAbsolute(source) ? join(dirname(importer), source) : source
        return CSS_VIRTUAL_PREFIX + abs + '.mjs'
      },
      async load(virtualId) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -'.mjs'.length)
        this.addWatchFile?.(fileId)
        const source = await readFile(fileId)
        const { transform } = await lightning()
        const { code, exports: cssExports } = transform({
          filename: fileId, code: source,
          cssModules: { pattern: '[hash]_[local]' }, minify: true,
        })
        const classMap = {}
        const exportEntries = Object.entries(cssExports ?? {})
          .sort(([a], [b]) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0)
        for (const [local, exp] of exportEntries) classMap[local] = exp.name
        return styleInjectionModule(id, fileId, code.toString(), classMap)
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      chunkFileNames: 'client.[name].js',
      banner: (chunk) =>
        `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(id)},\n\tfactory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export function externalClientBundle(id, entries, { clientEntry } = {}) {
  const configs = []
  if (entries.length > 0) configs.push({
    name: id,
    entry: Object.fromEntries(entries.map(e => [basename(e).replace(/\.(ts|tsx|js|mjs)$/, ''), e])),
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    sourcemap: false,
    clean: false,
    dts: false,
    deps: {
      neverBundle: (specifier) => !/^[./]/.test(specifier),
      alwaysBundle: (specifier) => /^[./]/.test(specifier),
    },
    outputOptions: { entryFileNames: '[name].js' },
  })
  if (clientEntry !== undefined) {
    if (configs.length === 0) {
      // Some call sites take `(...)[1]` and discard element 0; keep the client
      // config at index 1 even with no host entries.
      configs.push({ name: `${id}/placeholder`, entry: {}, outDir: 'lib', format: 'esm', platform: 'node', dts: false, sourcemap: false, clean: false })
    }
    configs.push(clientConfig(id, clientEntry))
  }
  return configs
}
