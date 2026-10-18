import type { SecureTokenStore, SavedToken } from '../../../src/auth/SecureTokenStore.js';
import { nativeCall } from './nativePort.js';
import type { Credentials, SecureCredentialStore } from '../../../src/auth/Credentials.js';

export class AndroidSecureTokenStore implements SecureTokenStore {
  get(): Promise<SavedToken | null> { return nativeCall('storeGet'); }
  set(value: SavedToken): Promise<void> {
    return nativeCall('storeSet', { token: value.token, savedAt: value.savedAt, expiresAt: value.expiresAt });
  }
  clear(): Promise<void> { return nativeCall('storeClear'); }
}

export class AndroidSecureCredentialStore implements SecureCredentialStore {
  get(): Promise<Credentials | null> { return nativeCall('credentialsGet'); }
  set(value: Credentials): Promise<void> { return nativeCall('credentialsSet', { username: value.username, password: value.password }); }
  clear(): Promise<void> { return nativeCall('credentialsClear'); }
}
