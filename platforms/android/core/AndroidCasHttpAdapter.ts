import type { CasHttpAdapter, CasHttpResponse } from '../../../src/auth/HttpCasSession.js';
import { trustedCasHttpUrl } from '../../../src/auth/HttpCasSession.js';
import { AuthCancelledError, AuthError } from '../../../src/auth/authErrors.js';
import { nativeCall } from './nativePort.js';

let next = 0;
export class AndroidCasHttpAdapter implements CasHttpAdapter {
  async request(url: string, method: 'GET' | 'POST', body: string | undefined, signal: AbortSignal): Promise<CasHttpResponse> {
    if (signal.aborted) throw new AuthCancelledError();
    const requestId = `cas-${++next}`;
    const cancel = () => { void nativeCall('casHttpCancel', { requestId }).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const response = await nativeCall<CasHttpResponse & { code?: string }>('casHttp', { requestId, url: trustedCasHttpUrl(url), method, body });
      if (signal.aborted) throw new AuthCancelledError();
      if (response.code === 'AUTH_TIMEOUT' || response.code === 'AUTH_DNS_FAILED') throw new AuthError(response.code, '', true);
      if (response.code === 'AUTH_TLS_FAILED') throw new AuthError(response.code, '');
      if (response.code || typeof response.status !== 'number' || typeof response.body !== 'string') throw new AuthError('AUTH_NETWORK_FAILED', '', true);
      return response;
    } catch (error) {
      if (signal.aborted) throw new AuthCancelledError();
      if (error instanceof AuthError) {
        if (error.code === 'NATIVE_UNAVAILABLE') throw new AuthError('AUTH_BRIDGE_FAILED', '');
        throw error;
      }
      throw new AuthError('AUTH_NETWORK_FAILED', '', true);
    } finally { signal.removeEventListener('abort', cancel); }
  }
}
