export type OperationStage = 'auth' | 'reserve-index' | 'reserve-list' | 'seat-date' | 'seat-list' | 'seat-select' | 'confirm';
export class BookingError extends Error {
  constructor(public readonly code: string, message: string, public stage?: OperationStage,
    public readonly httpStatus?: number, public readonly retryAfterMs?: number, public readonly transient = false) {
    super(message);
    this.name = 'BookingError';
  }
}

export async function atStage<T>(stage: OperationStage, work: () => Promise<T> | T): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof BookingError) { error.stage ??= stage; throw error; }
    throw new BookingError('UNEXPECTED_ERROR', '', stage);
  }
}

// Only keys, types and lengths: response values can contain personal information.
export function structureSummary(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { type: 'array', length: value.length, item: depth < 3 && value.length ? structureSummary(value[0], depth + 1) : undefined };
  if (typeof value === 'object') return depth >= 3 ? 'object' : Object.fromEntries(
    Object.entries(value).slice(0, 24).map(([key, item]) => [
      /^[a-zA-Z_][a-zA-Z_0-9]{0,40}$/.test(key) ? key : '[key]', structureSummary(item, depth + 1),
    ]),
  );
  return typeof value;
}

export function invalidShape(context: string, value: unknown): never {
  throw new BookingError('RESPONSE_SCHEMA_CHANGED', `${context}: unexpected response structure ${JSON.stringify(structureSummary(value))}`);
}

export function redact(text: string, token = ''): string {
  if (token) {
    for (const secret of [token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)]) {
      text = text.split(secret).join('[redacted]');
    }
  }
  return text.replace(/(["']?(?:authorization|cookie|set-cookie|token|cas|password|mobile|email|student_?id)["']?\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}]+)/gi, '$1[redacted]')
    .replace(/bearer[^\s"',}]+/gi, 'bearer[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\d{8,}\b/g, '[number]')
    .replace(/[\x00-\x1f\x7f]/g, ' ');
}
