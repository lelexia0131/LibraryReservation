import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthError } from '../authErrors.js';
import { validCredentials, type Credentials, type SecureCredentialStore } from '../Credentials.js';
import type { CredentialCipher } from './EncryptedFileTokenStore.js';

export class EncryptedFileCredentialStore implements SecureCredentialStore {
  private readonly directory: string;
  private readonly file: string;
  constructor(userDataDirectory: string, private readonly cipher: CredentialCipher) {
    this.directory = join(userDataDirectory, 'auth');
    this.file = join(this.directory, 'credentials.bin');
  }
  async get(): Promise<Credentials | null> {
    this.requireEncryption();
    let bytes: Buffer;
    try { bytes = await readFile(this.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AuthError('TOKEN_STORE_READ_FAILED', '');
    }
    try {
      const value: unknown = JSON.parse(this.cipher.decryptString(bytes));
      if (!validCredentials(value)) throw new Error();
      return { username: value.username, password: value.password };
    } catch { await this.clear(); return null; }
  }
  async set(value: Credentials): Promise<void> {
    this.requireEncryption();
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      if (!validCredentials(value)) throw new Error();
      const bytes = this.cipher.encryptString(JSON.stringify({ username: value.username, password: value.password }));
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.file);
    } catch { throw new AuthError('TOKEN_STORE_WRITE_FAILED', ''); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  async clear(): Promise<void> {
    try { await rm(this.file, { force: true }); }
    catch { throw new AuthError('TOKEN_STORE_CLEAR_FAILED', ''); }
  }
  private requireEncryption(): void {
    if (!this.cipher.isEncryptionAvailable()) throw new AuthError('SECURE_STORAGE_UNAVAILABLE', '');
  }
}
