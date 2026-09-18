import { spawn } from 'node:child_process';
import electron from 'electron';

// A shell inherited from an Electron host may set this; the desktop entry must launch a window.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('error', () => { console.error('Electron could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
