import { AuthError } from '../../../src/auth/authErrors.js';

interface NativePort { postMessage(message: string): void }
declare global { var NativeCore: NativePort }
export function nativeReady(): void {
  if (typeof NativeCore === 'undefined' || typeof NativeCore.postMessage !== 'function') throw new Error('NATIVE_CORE_MISSING');
  NativeCore.postMessage(JSON.stringify({ type: 'ready' }));
}
export function nativeReply(id: string, message: string): void {
  NativeCore.postMessage(JSON.stringify({ type: 'reply', id, message }));
}
let next = 0;
const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
export function nativeCall<T = void>(method: string, args: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = String(++next);
    pending.set(id, { resolve, reject });
    try { NativeCore.postMessage(JSON.stringify({ type: 'request', id, method, args })); }
    catch { pending.delete(id); reject(new AuthError('NATIVE_UNAVAILABLE', '')); }
  });
}
export function resolveNative(id: string, result: { ok: boolean; value?: unknown; code?: string }): void {
  const task = pending.get(id);
  if (!task) return;
  pending.delete(id);
  if (result.ok) task.resolve(result.value);
  else task.reject(new AuthError(result.code ?? 'NATIVE_UNAVAILABLE', ''));
}
