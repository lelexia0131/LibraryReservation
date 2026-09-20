import type { SecureTokenStore, SavedToken } from '../../../src/auth/SecureTokenStore.js';
import { nativeCall } from './nativePort.js';

export class AndroidSecureTokenStore implements SecureTokenStore {
  get(): Promise<SavedToken | null> { return nativeCall('storeGet'); }
  set(value: SavedToken): Promise<void> {
    return nativeCall('storeSet', { token: value.token, savedAt: value.savedAt, expiresAt: value.expiresAt });
  }
  clear(): Promise<void> { return nativeCall('storeClear'); }
}
