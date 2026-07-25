import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isMinify = process.argv.includes('--minify');

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/foo_plorg_smp.js',
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  target: 'es2019',
  // Keep readable during development - SMP reports errors against the
  // compiled file's line numbers, with no indication it resolves source
  // maps, so a minified bundle is hard to debug from a console error.
  minify: isMinify,
  legalComments: 'none',
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching for changes... (Ctrl+C to stop)');
} else {
  await esbuild.build(options);
}
