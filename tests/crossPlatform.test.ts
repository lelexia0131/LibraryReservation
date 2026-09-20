import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';
import { build } from 'esbuild';
import { channels } from '../src/application/contracts.js';
import { config, normalResponse, seat, area, type Request } from './fixtures.js';
import { jwt } from './authFixtures.js';

const bundle = await build({ entryPoints: ['platforms/android/core/index.ts'], bundle: true, platform: 'browser',
  target: 'chrome114', write: false, metafile: true, legalComments: 'none' });
const source = bundle.outputFiles[0]!.text;
const period = { day: config.targetDate, startTime: config.startTime, endTime: config.endTime };
const location = { premises: area.premisesName, floor: area.storeyName, area: area.name };
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) { if (check()) return; await tick(); }
  assert.fail('Core did not settle');
}
function android(outcome: 'success' | 'timeout' | '5xx' | 'malformed' | 'trailingJson' | 'business' | 'empty' | 'bridgeLost' = 'success') {
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  let saved: unknown = null;
  const requests: Array<{ path: string; payload: Record<string, unknown>; authorization: unknown }> = [];
  const publicReplies: unknown[] = [];
  const pending = new Map<string, (value: any) => void>();
  let sequence = 0;
  const context: any = { URL, URLSearchParams, AbortController, TextDecoder, atob, setTimeout, clearTimeout, console,
    NativeCore: {
      postMessage(text: string) {
        const { type, id, method, args, message } = JSON.parse(text);
        if (type === 'ready') {
          assert.equal(typeof context.TrustedCore.dispatch, 'function');
          assert.equal(typeof context.TrustedCore.resolve, 'function');
          return;
        }
        if (type === 'reply') { const value = JSON.parse(message); publicReplies.push(value); pending.get(id)?.(value); pending.delete(id); return; }
        assert.equal(type, 'request');
        queueMicrotask(() => {
          let value: unknown;
          if (method === 'storeGet') value = saved;
          else if (method === 'storeSet') saved = args;
          else if (method === 'storeClear') saved = null;
          else if (method === 'casLoad') context.TrustedCore.event({ id: args.id, kind: 'navigation', url: 'https://booking.lib.zju.edu.cn/h5/#/cas?cas=synthetic-credential' });
          else if (method === 'http') {
            requests.push(args);
            if (args.path === '/api/cas/user') {
              assert.equal(args.authorization, null); assert.deepEqual(args.payload, { cas: 'synthetic-credential' });
              value = { status: 200, data: { code: 1, member: { token, email: 'private@example.test' } } };
            } else {
              assert.equal(args.authorization, `bearer${token}`);
              assert.equal(args.payload.authorization, `bearer${token}`);
              const response = normalResponse({ path: args.path, body: args.payload } as Request);
              value = { status: 200, data: response };
              if (outcome === 'empty' && args.path === '/api/Seat/seat') value = { status: 200, data: { code: 1, data: [] } };
              if (args.path === '/api/Seat/confirm') {
                if (outcome === 'bridgeLost') { context.TrustedCore.resolve(id, { ok: false, code: 'NATIVE_UNAVAILABLE' }); return; }
                if (outcome === 'timeout') value = { code: 'ERR_NETWORK' };
                if (outcome === '5xx') value = { status: 503 };
                if (outcome === 'malformed') value = { status: 200, data: { nonsense: token } };
                if (outcome === 'trailingJson') value = { status: 200, body: '{"code":1,"msg":"success"}garbage' };
                if (outcome === 'business') value = { status: 200, data: { code: 42, msg: token } };
              }
            }
          } else assert.ok(['casCreate', 'casClose', 'casClear', 'httpCancel', 'openWebsite'].includes(method));
          if (method === 'http' && value && typeof value === 'object' && 'data' in value) {
            const { data, ...metadata } = value;
            value = { ...metadata, body: JSON.stringify(data) };
          }
          context.TrustedCore.resolve(id, { ok: true, value });
        });
      },
    },
  };
  // Deliberately no Buffer, process, require, Node crypto or renderer object.
  runInNewContext(source, context);
  const invoke = (command: string, input?: unknown): Promise<any> => new Promise(resolve => {
    const id = String(++sequence); pending.set(id, resolve); void context.TrustedCore.dispatch(id, command, input);
  });
  return { invoke, requests, context, publicReplies, getSaved: () => saved,
    async ready() { await until(() => saved !== null); await until(() => requests.length === 1); await tick(); },
    async shutdown() { await context.TrustedCore.shutdown(); },
  };
}

test('real Android browser bundle has no Node/Electron imports or platform stores', () => {
  for (const [path, input] of Object.entries(bundle.metafile.inputs)) {
    assert.doesNotMatch(path, /(?:^|\/)(?:electron|platform\/node|stores)\//);
    for (const dependency of input.imports) assert.doesNotMatch(dependency.path, /^(?:node:|electron$)|\b(?:fs|path|timers\/promises)$/);
  }
  assert.doesNotMatch(source, /node:(?:fs|path|crypto|timers)|ipcRenderer|BrowserWindow|safeStorage|\bBuffer\b|process\.env/);
});
test('renderer and Android public bridge contain only the public application contract', async () => {
  const renderer = await readFile('renderer/renderer.ts', 'utf8');
  assert.doesNotMatch(renderer, /electron|Capacitor|ipcRenderer|node:/);
  const publicBundle = await build({ entryPoints: ['platforms/android/bridge.ts', 'renderer/renderer.ts'], outdir: 'unused',
    bundle: true, platform: 'browser', target: 'chrome114', write: false, metafile: true });
  assert.doesNotMatch(Object.keys(publicBundle.metafile.inputs).join('\n'), /src\/(?:auth|api|crypto|domain)\/|LibraryController|ConfirmationAuthority/);
  for (const output of publicBundle.outputFiles) {
    assert.doesNotMatch(output.text, /NativeCore|TrustedCore|seat_id|segment|aesjson|authorization|\btoken\b|CAS credential/i);
  }
});
test('private bundle announces ready only after handlers exist, before native service requests', () => {
  const messages: string[] = [];
  const context: any = { URL, URLSearchParams, AbortController, TextDecoder, atob, setTimeout, clearTimeout,
    NativeCore: { postMessage(text: string) {
      const message = JSON.parse(text);
      messages.push(message.type);
      if (message.type === 'ready') {
        for (const handler of ['dispatch', 'resolve', 'event', 'suspend', 'resume', 'shutdown']) {
          assert.equal(typeof context.TrustedCore[handler], 'function');
        }
      }
    } },
  };
  runInNewContext(source, context);
  assert.deepEqual(messages, ['ready', 'request']);
});
test('missing injected NativeCore fails startup without a legacy bridge or retries', () => {
  assert.throws(() => runInNewContext(source, { AbortController }), /NATIVE_CORE_MISSING/);
  assert.throws(() => runInNewContext(source, { AbortController, NativeCore: { ready() { assert.fail('legacy bridge'); } } }), /NATIVE_CORE_MISSING/);
});
test('Android private core executes CAS exchange, minimal storage, cache and safe manual reservation', async () => {
  const h = android();
  try {
    await h.ready();
    assert.deepEqual(Object.keys(h.getSaved() as object).sort(), ['expiresAt', 'savedAt', 'token']);
    assert.deepEqual(await h.invoke(channels.status), { ok: true, value: { state: 'AUTHENTICATED' } });
    assert.equal((await h.invoke(channels.availability, period)).ok, true);
    const count = h.requests.length;
    await h.invoke(channels.availability, period); assert.equal(h.requests.length, count);
    const seats = await h.invoke(channels.seats, { ...period, location }); assert.deepEqual(seats.value.seats, [seat.no]);
    const result = await h.invoke(channels.manual, { ...period, location, seat: seat.no }); assert.equal(result.value.success, true);
    assert.equal(h.requests.filter(r => r.path.endsWith('/confirm')).length, 1);
    assert.doesNotMatch(JSON.stringify(h.publicReplies), /token|synthetic-credential|authorization|cookie|seat_id|segment|aesjson|80023|411|private@example/);
    await h.invoke(channels.logout); assert.equal(h.getSaved(), null);
  } finally { await h.shutdown(); }
});
for (const outcome of ['timeout', '5xx', 'malformed', 'trailingJson', 'business', 'bridgeLost'] as const) {
  test(`Android manual ${outcome} is not replayed and preserves unknown versus rejected outcome`, async () => {
    const h = android(outcome);
    try {
      await h.ready();
      const result = await h.invoke(channels.manual, { ...period, location, seat: seat.no });
      if (outcome === 'business') assert.equal(result.value.success, false);
      else assert.equal(result.error.code, 'CONFIRM_OUTCOME_UNKNOWN');
      assert.equal(h.requests.filter(r => r.path.endsWith('/confirm')).length, 1);
    } finally { await h.shutdown(); }
  });
}
for (const outcome of ['success', 'timeout', '5xx', 'malformed', 'bridgeLost'] as const) {
  test(`Android automatic ${outcome} stops after one confirm through the native transport adapter`, async () => {
    const h = android(outcome);
    try {
      await h.ready();
      await h.invoke(channels.autoStart, { ...period, mode: 'all', scopes: [] });
      let status: any;
      for (let i = 0; i < 100; i++) { status = await h.invoke(channels.autoStatus); if (['SUCCESS', 'FAILED'].includes(status.value.state)) break; await tick(); }
      assert.equal(status.value.state, outcome === 'success' ? 'SUCCESS' : 'FAILED');
      if (outcome !== 'success') assert.match(status.value.message, /结果未知/);
      assert.equal(h.requests.filter(r => r.path.endsWith('/confirm')).length, 1);
      await tick(); assert.equal(h.requests.filter(r => r.path.endsWith('/confirm')).length, 1);
    } finally { await h.shutdown(); }
  });
}
test('Android core rejects forged capabilities, private commands and direct HTTP paths', async () => {
  const h = android();
  try {
    await h.ready();
    for (const command of ['http', 'storeGet', 'getToken', 'shutdown', 'constructor', '/api/Seat/confirm']) assert.equal((await h.invoke(command)).error.code, 'FORBIDDEN');
    for (const extra of [{ permit: true }, { seat_id: '80023' }, { segment: '411' }, { aesjson: 'cipher' }]) {
      assert.equal((await h.invoke(channels.manual, { ...period, location, seat: seat.no, ...extra })).error.code, 'INVALID_INPUT');
    }
    assert.equal(h.requests.length, 1);
  } finally { await h.shutdown(); }
});
test('Android foreground automatic selection shares monitor, suspension stops and resumption never restarts', async () => {
  const h = android('empty');
  try {
    await h.ready();
    await h.invoke(channels.autoStart, { ...period, mode: 'all', scopes: [] });
    let status: any;
    for (let i = 0; i < 100; i++) { status = await h.invoke(channels.autoStatus); if (status.value.state === 'WAITING') break; await tick(); }
    assert.equal(status.value.state, 'WAITING');
    await h.context.TrustedCore.suspend();
    const count = h.requests.length;
    assert.equal((await h.invoke(channels.autoStatus)).value.state, 'STOPPED');
    assert.equal((await h.invoke(channels.autoStart, { ...period, mode: 'all', scopes: [] })).error.code, 'STOPPED');
    h.context.TrustedCore.resume(); await tick();
    assert.equal(h.requests.length, count);
    assert.equal((await h.invoke(channels.autoStatus)).value.state, 'STOPPED');
  } finally { await h.shutdown(); }
});
