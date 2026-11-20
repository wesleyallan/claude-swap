import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { main: 'src/server/main.ts' },
  outDir: 'dist/server',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
})
