import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthError } from './authErrors.js';

// All timestamps are milliseconds since the Unix epoch.
export interface SavedToken { token: string; savedAt: number; expiresAt?: number }
export interface SecureTokenStore {
  get(): Promise<SavedToken | null>;
  set(token: SavedToken): Promise<void>;
  clear(): Promise<void>;
}

// A desktop host must bind this to its OS-backed credential encryption, never a bundled key.
export interface CredentialCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class EncryptedFileTokenStore implements SecureTokenStore {
  private readonly directory: string;
  private readonly file: string;
  constructor(userDataDirectory: string, private readonly cipher: CredentialCipher) {
    this.directory = join(userDataDirectory, 'auth');
    this.file = join(this.directory, 'token.bin');
  }
  async get(): Promise<SavedToken | null> {
    let bytes: Buffer;
    try { bytes = await readFile(this.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AuthError('TOKEN_STORE_READ_FAILED', 'Secure token storage could not be read.');
    }
    this.requireEncryption();
    try {
      const value = JSON.parse(this.cipher.decryptString(bytes)) as SavedToken;
      if (!value || typeof value.token !== 'string' || !value.token.trim() || !Number.isFinite(value.savedAt)
        || (value.expiresAt !== undefined && !Number.isFinite(value.expiresAt))) throw new Error();
      return { token: value.token, savedAt: value.savedAt, ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}) };
    } catch {
      await this.clear();
      return null;
    }
  }
  async set(value: SavedToken): Promise<void> {
    this.requireEncryption();
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      // Serialize only the allowlisted fields; member/profile data must never be persisted.
      const bytes = this.cipher.encryptString(JSON.stringify({ token: value.token, savedAt: value.savedAt, expiresAt: value.expiresAt }));
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.file);
    } catch { throw new AuthError('TOKEN_STORE_WRITE_FAILED', 'Token could not be saved securely.'); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  async clear(): Promise<void> {
    try { await rm(this.file, { force: true }); }
    catch { throw new AuthError('TOKEN_STORE_CLEAR_FAILED', 'Secure token storage could not be cleared.'); }
  }
  private requireEncryption(): void {
    if (!this.cipher.isEncryptionAvailable()) throw new AuthError('SECURE_STORAGE_UNAVAILABLE', 'OS-backed credential encryption is unavailable.');
  }
}
