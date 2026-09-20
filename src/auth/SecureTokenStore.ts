// All timestamps are milliseconds since the Unix epoch.
export interface SavedToken { token: string; savedAt: number; expiresAt?: number }
export interface SecureTokenStore {
  get(): Promise<SavedToken | null>;
  set(token: SavedToken): Promise<void>;
  clear(): Promise<void>;
}
