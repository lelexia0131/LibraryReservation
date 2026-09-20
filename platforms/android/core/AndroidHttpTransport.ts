import { HttpTransportError, type HttpTransport, type HttpRequestOptions } from '../../../src/api/HttpTransport.js';
import { nativeCall } from './nativePort.js';

let next = 0;
export class AndroidHttpTransport implements HttpTransport {
  async post(path: string, payload: object, options: HttpRequestOptions) {
    if (options.signal?.aborted) throw new HttpTransportError(undefined, 'ERR_CANCELED');
    const requestId = String(++next);
    const abort = () => { void nativeCall('httpCancel', { requestId }).catch(() => {}); };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await nativeCall<{ status?: number; body?: string; code?: string; retryAfter?: string }>('http', {
        requestId, path, payload, authorization: options.headers.authorization || null,
      });
      if (result.code || !result.status || result.status < 200 || result.status >= 300) {
        throw new HttpTransportError(result.status, result.code, result.retryAfter);
      }
      let data: unknown;
      try { data = JSON.parse(result.body ?? ''); }
      catch { data = result.body; } // Shared parsers reject malformed receipts as an unknown outcome.
      return { data };
    } catch (error) {
      // Losing the native bridge is also a transport failure, never evidence that confirm failed.
      if (error instanceof HttpTransportError) throw error;
      throw new HttpTransportError(undefined, 'ERR_NETWORK');
    } finally { options.signal?.removeEventListener('abort', abort); }
  }
}
