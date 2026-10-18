import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AndroidCasHttpAdapter } from '../platforms/android/core/AndroidCasHttpAdapter.js';
import { resolveNative } from '../platforms/android/core/nativePort.js';
import { safeError } from '../src/application/LibraryController.js';

for (const code of ['AUTH_TIMEOUT', 'AUTH_DNS_FAILED', 'AUTH_TLS_FAILED', 'NATIVE_UNAVAILABLE']) {
  test(`Android auth reports ${code} without losing its cause or exposing native data`, async () => {
    const previous = globalThis.NativeCore;
    globalThis.NativeCore = { postMessage(message) {
      const request = JSON.parse(message);
      assert.equal(request.method, 'casHttp');
      queueMicrotask(() => resolveNative(request.id, code === 'NATIVE_UNAVAILABLE'
        ? { ok: false, code }
        : { ok: true, value: { code, detail: 'private-native-data' } }));
    } };
    try {
      await assert.rejects(new AndroidCasHttpAdapter().request('https://booking.lib.zju.edu.cn/api/cas/cas', 'GET', undefined,
        new AbortController().signal), error => {
        const reply = safeError(error);
        assert.equal(reply.error.code, code === 'NATIVE_UNAVAILABLE' ? 'AUTH_BRIDGE_FAILED' : code);
        assert.doesNotMatch(JSON.stringify(error), /private-native-data/);
        assert.doesNotMatch(JSON.stringify(reply), /private-native-data/);
        return true;
      });
    } finally { globalThis.NativeCore = previous; }
  });
}
