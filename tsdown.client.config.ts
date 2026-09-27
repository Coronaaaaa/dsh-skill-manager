/**
 * Browser-half closure-factory config. Invoked by `pnpm build:client` (or the
 * composite `build` script in package.json). The plugin's panel has been
 * wired into the GUI's __ModuleLoader__ through the package's `./client`
 * export; this config bundles the closure-factory artifact and writes it
 * alongside the host half (dist/client.{mjs,d.mts} + style.css).
 */
import { defineConfig } from 'tsdown'
import { CssPlugin } from '@tsdown/css'

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: false,
  plugins: [CssPlugin({}, { logger: console })],
  external: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/cordis',
    'react',
    'react-dom',
  ],
})