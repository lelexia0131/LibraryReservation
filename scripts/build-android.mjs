import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

await mkdir('out/android', { recursive: true });
await build({ entryPoints: ['renderer/renderer.ts'], outfile: 'out/android/renderer.js',
  bundle: true, platform: 'browser', target: 'chrome114', legalComments: 'none' });
await Promise.all(['index.html', 'style.css'].map(file => copyFile(`renderer/${file}`, `out/android/${file}`)));
await build({ entryPoints: ['platforms/android/bridge.ts'], outfile: 'out/android/android-bridge.js',
  bundle: true, platform: 'browser', target: 'chrome114', legalComments: 'none' });
await writeFile('out/android/index.html', (await readFile('renderer/index.html', 'utf8'))
  .replace('<script src="renderer.js">', '<script src="android-bridge.js"></script><script src="renderer.js">'));
await mkdir('android/app/src/main/assets', { recursive: true });
await build({ entryPoints: ['platforms/android/core/index.ts'], outfile: 'android/app/src/main/assets/private-core.js',
  bundle: true, platform: 'browser', target: 'chrome114', legalComments: 'none' });
