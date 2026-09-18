import type { safeStorage } from 'electron';
import type { CredentialCipher } from '../../src/auth/SecureTokenStore.js';

export class ElectronCredentialCipher implements CredentialCipher {
  constructor(private readonly storage: Pick<typeof safeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>) {}
  isEncryptionAvailable(): boolean { return this.storage.isEncryptionAvailable(); }
  encryptString(value: string): Buffer { return this.storage.encryptString(value); }
  decryptString(value: Buffer): string { return this.storage.decryptString(value); }
}
