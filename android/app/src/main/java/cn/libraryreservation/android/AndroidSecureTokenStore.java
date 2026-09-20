package cn.libraryreservation.android;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class AndroidSecureTokenStore {
    private static final String ALIAS = "library-booking-token-v1";
    private final AtomicFile file;
    AndroidSecureTokenStore(Context context) { file = new AtomicFile(new File(context.getNoBackupFilesDir(), "booking-token.bin")); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    private JSONObject minimal(JSONObject input) throws Exception {
        String token = input.getString("token");
        if (token.isEmpty() || !token.equals(token.trim()) || !Double.isFinite(input.getDouble("savedAt"))) throw new Exception();
        JSONObject value = new JSONObject().put("token", token).put("savedAt", input.getLong("savedAt"));
        if (input.has("expiresAt")) {
            if (!Double.isFinite(input.getDouble("expiresAt"))) throw new Exception();
            value.put("expiresAt", input.getLong("expiresAt"));
        }
        return value;
    }
    synchronized JSONObject get() throws Exception {
        if (!file.getBaseFile().exists()) return null;
        byte[] bytes = file.readFully();
        SecretKey key = key();
        try {
            ByteBuffer buffer = ByteBuffer.wrap(bytes);
            if (buffer.get() != 1) throw new Exception();
            byte[] iv = new byte[12]; buffer.get(iv);
            byte[] encrypted = new byte[buffer.remaining()]; buffer.get(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            return minimal(new JSONObject(new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)));
        } catch (Exception ignored) { clear(); return null; }
    }
    synchronized void set(JSONObject input) throws Exception {
        byte[] plaintext = minimal(input).toString().getBytes(StandardCharsets.UTF_8);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(plaintext);
        byte[] output = ByteBuffer.allocate(1 + cipher.getIV().length + encrypted.length)
            .put((byte) 1).put(cipher.getIV()).put(encrypted).array();
        FileOutputStream stream = null;
        try { stream = file.startWrite(); stream.write(output); file.finishWrite(stream); }
        catch (Exception error) { if (stream != null) file.failWrite(stream); throw error; }
    }
    synchronized void clear() throws Exception {
        file.delete();
        if (file.getBaseFile().exists()) throw new Exception();
    }
}
