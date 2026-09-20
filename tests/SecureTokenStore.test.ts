import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedFileTokenStore, type CredentialCipher } from '../src/auth/stores/EncryptedFileTokenStore.js';
import { jwt, now } from './authFixtures.js';

// Test-only cipher. Production must supply OS-backed encryption; no key is persisted here.
function testCipher(): CredentialCipher {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptString(bytes) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
}
test('encrypted file persists only minimal fields, replaces atomically and recovers corruption', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-auth-test-'));
  try {
    const cipher = testCipher();
    const store = new EncryptedFileTokenStore(directory, cipher);
    const file = join(directory, 'auth', 'token.bin');
    assert.equal(await store.get(), null);
    const saved = { token: jwt(), savedAt: now, expiresAt: now + 3600000, member: { email: 'private@example.test' } };
    await store.set(saved);
    const bytes = await readFile(file);
    assert.ok(!bytes.includes(Buffer.from(jwt())));
    assert.ok(!bytes.includes(Buffer.from('private@example.test')));
    const restored = await new EncryptedFileTokenStore(directory, cipher).get();
    assert.deepEqual(restored, { token: jwt(), savedAt: now, expiresAt: now + 3600000 });
    await store.set({ token: jwt(now / 1000 + 7200), savedAt: now });
    assert.equal((await store.get())!.token, jwt(now / 1000 + 7200));
    assert.deepEqual(await readdir(join(directory, 'auth')), ['token.bin']);
    await writeFile(file, Buffer.from('damaged-ciphertext'));
    assert.equal(await store.get(), null);
    assert.deepEqual(await readdir(join(directory, 'auth')), []);
    await store.clear();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('encryption unavailable fails closed, never writes plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-auth-test-'));
  try {
    const store = new EncryptedFileTokenStore(directory, { ...testCipher(), isEncryptionAvailable: () => false });
    await assert.rejects(store.set({ token: jwt(), savedAt: now }), { code: 'SECURE_STORAGE_UNAVAILABLE' });
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('failed encryption preserves old ciphertext and withholds adapter errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'booking-auth-test-'));
  try {
    const cipher = testCipher();
    const store = new EncryptedFileTokenStore(directory, cipher);
    await store.set({ token: jwt(), savedAt: now });
    cipher.encryptString = () => { throw new Error(jwt()); };
    await assert.rejects(store.set({ token: 'replacement', savedAt: now }), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes(jwt()));
      return true;
    });
    assert.equal((await store.get())?.token, jwt());
    assert.deepEqual(await readdir(join(directory, 'auth')), ['token.bin']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
