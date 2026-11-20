import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    exclude: ['tests/acceptance/**'],
    fileParallelism: true,
    isolate: true,
    retry: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'lib/types/observation/**/*.js',
        'lib/types/hub/**/*.js',
        'lib/types/log.js',
        'lib/types/client/step-timeline.js',
        'lib/types/client/disclosure-depth.js',
        'src/insights/**/*.mjs',
        // Modules that tests import from src/ rather than from lib/types/.
        'src/dsh-watcher.ts',
        'src/insights/**/*.ts',
        'src/client/context-reading.ts',
        'src/client/anchored-position.ts',
      ],
      exclude: ['lib/types/hub/watcher.js'],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
      },
    },
  },
})
