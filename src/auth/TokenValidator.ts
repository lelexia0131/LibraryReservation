export const TOKEN_EXPIRY_SKEW_SECONDS = 60;

// Local cache hint only, never a signature or identity verification.
export function parseJwtExpiry(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return undefined;
  try {
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const exp = payload && typeof payload === 'object' && 'exp' in payload ? payload.exp : undefined;
    return typeof exp === 'number' && Number.isSafeInteger(exp) && exp >= 0 && Number.isSafeInteger(exp * 1000) ? exp * 1000 : undefined;
  } catch { return undefined; }
}

export class TokenValidator {
  constructor(private readonly now: () => number = Date.now, private readonly skewSeconds = TOKEN_EXPIRY_SKEW_SECONDS) {
    if (!Number.isFinite(skewSeconds) || skewSeconds < 0) throw new RangeError('Invalid token expiry skew.');
  }
  isUsable(token: string): boolean {
    const expiresAt = parseJwtExpiry(token);
    return expiresAt !== undefined && expiresAt > this.now() + this.skewSeconds * 1000;
  }
}
