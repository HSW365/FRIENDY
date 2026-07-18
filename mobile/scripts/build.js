// Bundles mobile/src/native-bridge.js -> mobile/www/native-bridge.bundle.js
// Run via `npm run build` inside mobile/ (Codemagic does this before `cap sync`).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const outdir = path.join(__dirname, '..', 'www');
if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'native-bridge.js')],
  bundle: true,
  format: 'iife',
  target: ['ios14'],
  outfile: path.join(outdir, 'native-bridge.bundle.js'),
  sourcemap: false,
  minify: true
});

console.log('✅ native-bridge.bundle.js built into mobile/www/');
