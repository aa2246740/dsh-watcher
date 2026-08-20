import { externalClientBundle } from '../../tools/dshx/src/client-build.js'

export default externalClientBundle('dsh-watcher', ['lib/types/dsh-watcher.js'], {
  clientEntry: 'src/client/index.tsx',
})
