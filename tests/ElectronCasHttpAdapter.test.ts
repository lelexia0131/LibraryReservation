import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ClientRequest, Session } from 'electron';
import { ElectronCasHttpAdapter } from '../electron/adapters/ElectronCasHttpAdapter.js';

test('main-only exchange uses private scoped Cookies while Chromium exchange remains blocked', async () => {
  let chromium = 0, node = 0;
  const session = {
    async fetch() { assert.fail('session.fetch cancels manual redirects'); },
    cookies: { async get(filter: { url: string }) {
      assert.equal(filter.url, 'https://booking.lib.zju.edu.cn/api/cas/user');
      return [{ name: 'PHPSESSID', value: 'synthetic-cookie' }];
    }, async flushStore() {} },
  } as unknown as Session;
  const http = new ElectronCasHttpAdapter(session, options => {
    chromium++;
    assert.equal(options.session, session);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'include');
    assert.equal(options.url, 'https://booking.lib.zju.edu.cn/api/cas/cas');
    const request = new EventEmitter();
    return Object.assign(request, {
      end() { queueMicrotask(() => {
        request.emit('redirect', 302, 'GET', 'https://zjuam.zju.edu.cn/cas/login', {});
        request.emit('error', new Error('Redirect was cancelled'));
      }); },
      abort() { request.emit('abort'); },
      followRedirect() { assert.fail('Redirect must be validated by the shared core first'); },
    }) as unknown as ClientRequest;
  });
  mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    node++;
    assert.equal(url.href, 'https://booking.lib.zju.edu.cn/api/cas/user');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Cookie'), 'PHPSESSID=synthetic-cookie');
    assert.equal(headers.get('X-Requested-With'), 'XMLHttpRequest');
    assert.equal(headers.get('authorization'), null);
    assert.deepEqual(JSON.parse(init.body as string), { cas: 'synthetic-cas' });
    return new Response('{"code":1,"member":{"token":"synthetic-token"}}');
  });
  try {
    const signal = new AbortController().signal;
    assert.equal((await http.request('https://booking.lib.zju.edu.cn/api/cas/cas', 'GET', undefined, signal)).status, 302);
    assert.equal((await http.request('https://booking.lib.zju.edu.cn/api/cas/user', 'POST', '{"cas":"synthetic-cas"}', signal)).status, 200);
    assert.equal(chromium, 1); assert.equal(node, 1);
    for (const body of ['{}', '{"cas":"synthetic-cas","url":"https://evil.test"}']) {
      await assert.rejects(http.request('https://booking.lib.zju.edu.cn/api/cas/user', 'POST', body, signal), { code: 'CAS_PROTOCOL_CHANGED' });
    }
    assert.equal(node, 1);
  } finally { mock.restoreAll(); }
});

test('native request reads a complete UTF-8 response and preserves the private session', async () => {
  const session = { cookies: { async flushStore() {} } } as unknown as Session;
  const http = new ElectronCasHttpAdapter(session, options => {
    assert.equal(options.session, session);
    const request = new EventEmitter();
    return Object.assign(request, { end() { queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
      request.emit('response', response);
      const bytes = Buffer.from('统一身份认证');
      response.emit('data', bytes.subarray(0, 2)); response.emit('data', bytes.subarray(2)); response.emit('end');
    }); }, abort() {} }) as unknown as ClientRequest;
  });
  assert.equal((await http.request('https://zjuam.zju.edu.cn/cas/login', 'GET', undefined, new AbortController().signal)).body, '统一身份认证');
});

test('cancel aborts an outstanding native request without leaking transport details', async () => {
  let aborts = 0;
  const controller = new AbortController();
  const http = new ElectronCasHttpAdapter({} as Session, () => Object.assign(new EventEmitter(), {
    end() {}, abort() { aborts++; },
  }) as unknown as ClientRequest);
  const result = assert.rejects(http.request('https://zjuam.zju.edu.cn/cas/login', 'GET', undefined, controller.signal), { code: 'AUTH_CANCELLED' });
  controller.abort(); await result;
  assert.equal(aborts, 1);
});
