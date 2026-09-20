export interface HttpRequestOptions {
  baseURL: string;
  headers: { authorization: string | false | undefined; cookie: false };
  timeout: number;
  maxRedirects: number;
  signal?: AbortSignal;
}
export interface HttpResponse { data: unknown }
export interface HttpTransport {
  post(path: string, payload: object, options: HttpRequestOptions): Promise<HttpResponse>;
}
// Adapter errors contain metadata only, never a request, response body or credential.
export class HttpTransportError extends Error {
  constructor(readonly status?: number, readonly code?: string, readonly retryAfter?: string | number) {
    super('Transport request failed');
  }
}
