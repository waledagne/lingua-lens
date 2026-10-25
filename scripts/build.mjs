import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
const options = {
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/popup.ts', 'src/setup.ts', 'src/engine.ts', 'src/segment-worker.ts'],
  outdir: 'dist', bundle: true, format: 'iife', target: 'chrome138',
  sourcemap: true, logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching TypeScript. Reload the extension after changes; restart this command for public/ changes.');
} else {
  await build(options);
}
