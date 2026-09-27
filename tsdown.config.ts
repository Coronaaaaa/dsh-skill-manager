/**
 * Standalone tsdown config for the skill-manager plugin.
 *
 * Host half (dist/index.js) compiles src/index.ts as a plain ESM library;
 * browser half (see tsdown.client.config.ts) compiles src/client/index.ts
 * as a closure-factory artifact for the GUI's __ModuleLoader__, with CSS
 * Modules inlined and a <style data-plugin> auto-injection hook.
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: true,
  external: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/cordis',
    'react',
    'react-dom',
  ],
})