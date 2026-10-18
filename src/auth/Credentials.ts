export interface Credentials { username: string; password: string }
export interface LoginInput extends Credentials { remember: boolean }
export interface SecureCredentialStore {
  get(): Promise<Credentials | null>;
  set(value: Credentials): Promise<void>;
  clear(): Promise<void>;
}

export function validCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== 'object') return false;
  const input = value as Credentials;
  return typeof input.username === 'string' && !!input.username.trim() && input.username.length <= 100
    && typeof input.password === 'string' && !!input.password && input.password.length <= 256
    && !/[\x00-\x1f\x7f]/.test(input.username + input.password);
}
