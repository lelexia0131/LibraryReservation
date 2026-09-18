import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('out/renderer', { recursive: true });
await Promise.all([
  build({ entryPoints: ['electron/main.ts'], outfile: 'out/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], legalComments: 'none' }),
  build({ entryPoints: ['electron/preload.ts'], outfile: 'out/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], legalComments: 'none' }),
  build({ entryPoints: ['renderer/renderer.ts'], outfile: 'out/renderer/renderer.js', bundle: true, platform: 'browser', target: 'chrome130', legalComments: 'none' }),
  ...['index.html', 'style.css'].map(file => copyFile(`renderer/${file}`, `out/renderer/${file}`)),
  copyFile('build/icon.ico', 'out/icon.ico'),
]);
