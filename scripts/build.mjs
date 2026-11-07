// Builds the addon: bundles the Ravensight JavaScript SDK and the glue into
// addon/c3runtime, then zips addon/ into dist/ravensight-<version>.c3addon.
//
//   node scripts/build.mjs            build and zip
//   node scripts/build.mjs --no-zip   build only (the tests)
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));

const sdkDir = dirname(require.resolve('ravensight/package.json'));
const sdkPackage = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
const cjs = readFileSync(join(sdkDir, 'dist', 'index.cjs'), 'utf8');
const sha = createHash('sha256').update(cjs).digest('hex');

const bundled =
  `// The Ravensight JavaScript SDK ${sdkPackage.version} (MIT), bundled for Construct.\n` +
  `// Source: ravensight/dist/index.cjs, sha256 ${sha}. Built by scripts/build.mjs; do not edit.\n` +
  `// Sets globalThis.RavensightSDK.\n` +
  `(function () {\n` +
  `var module = { exports: {} };\n` +
  `var exports = module.exports;\n` +
  cjs +
  `\nglobalThis.RavensightSDK = module.exports;\n` +
  `})();\n`;

writeFileSync(join(root, 'addon', 'c3runtime', 'ravensight.js'), bundled);
writeFileSync(join(root, 'addon', 'c3runtime', 'glue.js'), readFileSync(join(root, 'src', 'glue.js'), 'utf8'));

const addon = JSON.parse(readFileSync(join(root, 'addon', 'addon.json'), 'utf8'));
const version = addon.version.split('.').slice(0, 3).join('.');
if (!process.argv.includes('--no-zip')) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  const out = join(root, 'dist', `ravensight-${version}.c3addon`);
  rmSync(out, { force: true });
  execFileSync('zip', ['-q', '-r', '-X', out, ...addon['file-list']], { cwd: join(root, 'addon') });
  console.log(`built ${out} with the JavaScript SDK ${sdkPackage.version}`);
} else {
  console.log(`built addon/c3runtime with the JavaScript SDK ${sdkPackage.version}`);
}
