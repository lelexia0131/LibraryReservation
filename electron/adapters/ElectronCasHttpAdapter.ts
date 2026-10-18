import type { ClientRequest, ClientRequestConstructorOptions, Session } from 'electron';
import { AuthCancelledError, AuthError } from '../../src/auth/authErrors.js';
import { trustedCasHttpUrl, type CasHttpAdapter, type CasHttpResponse } from '../../src/auth/HttpCasSession.js';

export class ElectronCasHttpAdapter implements CasHttpAdapter {
  constructor(private readonly session: Session,
    private readonly createRequest: (options: ClientRequestConstructorOptions) => ClientRequest) {}

  private requestSession(url: string, init: RequestInit): Promise<CasHttpResponse> {
    return new Promise((resolve, reject) => {
      const request = this.createRequest({ url, method: init.method, session: this.session,
        credentials: 'include', redirect: 'manual', cache: 'no-store', headers: Object.fromEntries(new Headers(init.headers)) });
      let settled = false;
      const clean = () => init.signal?.removeEventListener('abort', cancel);
      const fail = () => {
        if (settled) return;
        settled = true; clean();
        reject(new AuthError('AUTH_NETWORK_FAILED', '', true));
      };
      const finish = (response: CasHttpResponse) => {
        if (settled) return;
        settled = true; clean(); resolve(response);
      };
      const cancel = () => { fail(); request.abort(); };
      request.on('error', fail);
      request.on('abort', fail);
      // session.fetch rejects a normal 302 as "Redirect was cancelled" in manual
      // mode. Capture it before cancellation; the shared core validates the next URL.
      request.on('redirect', (status, _method, location) => {
        finish({ status, body: '', location });
        request.abort();
      });
      request.on('response', response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => { chunks.push(Buffer.from(chunk)); });
        response.on('error', fail);
        response.on('end', () => {
          const location = response.headers.location;
          finish({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8'),
            location: Array.isArray(location) ? location[0] : location });
        });
      });
      init.signal?.addEventListener('abort', cancel, { once: true });
      if (init.signal?.aborted) cancel(); else request.end(init.body as string | undefined);
    });
  }
  async request(url: string, method: 'GET' | 'POST', body: string | undefined, signal: AbortSignal): Promise<CasHttpResponse> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 8000);
    try {
      if (signal.aborted) throw new AuthCancelledError();
      const target = new URL(trustedCasHttpUrl(url));
      const exchange = target.pathname === '/api/cas/user';
      if (exchange) {
        const data = JSON.parse(body ?? '{}');
        if (method !== 'POST' || target.search || Object.keys(data).length !== 1 || typeof data.cas !== 'string') throw new AuthError('CAS_PROTOCOL_CHANGED', '');
      } else if (method === 'POST' && (target.origin !== 'https://zjuam.zju.edu.cn' || target.pathname !== '/cas/login')) throw new AuthError('CAS_PROTOCOL_CHANGED', '');
      const init: RequestInit = { method, body, redirect: 'manual',
        credentials: 'include', signal: controller.signal,
        headers: method === 'POST' ? { 'Content-Type': exchange ? 'application/json' : 'application/x-www-form-urlencoded', Origin: target.origin,
          ...(exchange ? { 'X-Requested-With': 'XMLHttpRequest', lang: 'zh' } : {}) } : {} };
      // Chromium deliberately blocks /api/cas/user for every remote page. Use Node
      // only for this terminal exchange, reading scoped Cookies inside the main process.
      if (exchange) {
        const cookies = await this.session.cookies.get({ url: target.href });
        const headers = new Headers(init.headers);
        if (cookies.length) headers.set('Cookie', cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '));
        init.headers = headers;
      }
      let result: CasHttpResponse;
      if (exchange) {
        const response = await fetch(target, init);
        result = { status: response.status, body: await response.text(), location: response.headers.get('location') ?? undefined };
      } else result = await this.requestSession(target.href, init);
      await this.session.cookies.flushStore();
      return result;
    } catch (error) {
      if (signal.aborted) throw new AuthCancelledError();
      if (error instanceof AuthError) throw error;
      throw new AuthError('AUTH_NETWORK_FAILED', '', true);
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  }
}
