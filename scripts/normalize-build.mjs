import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const root = resolve(import.meta.dirname, '..')
for (const file of await readdir(join(root, 'lib'))) {
  if (!/\.(?:js|map)$/.test(file)) continue
  const path = join(root, 'lib', file)
  const text = await readFile(path, 'utf8')
  const portable = text.replaceAll(root + '/', './')
  if (portable !== text) await writeFile(path, portable)
}
