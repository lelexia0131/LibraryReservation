package cn.libraryreservation.android;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import javax.net.ssl.SSLException;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.CookieJar;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

final class AndroidHttpTransport {
    private static final Set<String> PATHS = Set.of("/api/cas/user", "/reserve/index/index", "/reserve/index/list",
        "/reserve/index/detail", "/api/Seat/date", "/api/Seat/seat", "/api/Seat/confirm");
    static OkHttpClient createClient() {
        return new OkHttpClient.Builder().retryOnConnectionFailure(false)
            .followRedirects(false).followSslRedirects(false).cookieJar(CookieJar.NO_COOKIES)
            .callTimeout(8, TimeUnit.SECONDS).connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).build();
    }
    static RequestBody oneShotBody(String json) {
        byte[] bytes = json.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return new RequestBody() {
            @Override public MediaType contentType() { return MediaType.get("application/json; charset=utf-8"); }
            @Override public long contentLength() { return bytes.length; }
            // Also prevents HTTP follow-ups such as 503 Retry-After: 0, independently of connection retries.
            @Override public boolean isOneShot() { return true; }
            @Override public void writeTo(okio.BufferedSink sink) throws IOException { sink.write(bytes); }
        };
    }
    private final OkHttpClient client = createClient();
    private final Map<String, Call> calls = new ConcurrentHashMap<>();
    void post(JSONObject args, Consumer<JSONObject> done) throws Exception {
        String path = args.getString("path"), id = args.getString("requestId");
        if (!PATHS.contains(path) || calls.containsKey(id)) throw new Exception();
        Request.Builder request = new Request.Builder().url("https://booking.lib.zju.edu.cn" + path)
            .header("X-Requested-With", "XMLHttpRequest").header("lang", "zh")
            .post(oneShotBody(args.getJSONObject("payload").toString()));
        if (!args.isNull("authorization")) request.header("authorization", args.getString("authorization"));
        Call call = client.newCall(request.build()); calls.put(id, call);
        call.enqueue(new Callback() {
            @Override public void onFailure(Call failed, IOException error) {
                calls.remove(id);
                done.accept(json("code", failed.isCanceled() ? "ERR_CANCELED" : error instanceof SSLException ? "TLS_ERROR" : "ERR_NETWORK"));
            }
            @Override public void onResponse(Call completed, Response response) {
                try (response) {
                    JSONObject result = json("status", response.code());
                    String retry = response.header("Retry-After");
                    if (retry != null) result.put("retryAfter", retry);
                    if (response.isSuccessful()) {
                        // Parse strictly in the shared JS context; Android JSONTokener accepts malformed JSON.
                        result.put("body", response.body() == null ? "" : response.body().string());
                    }
                    done.accept(result);
                } catch (Exception ignored) { done.accept(json("code", "ERR_NETWORK")); }
                finally { calls.remove(id); }
            }
        });
    }
    void cancel(String id) { Call call = calls.get(id); if (call != null) call.cancel(); }
    void close() { client.dispatcher().cancelAll(); client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll(); }
    static JSONObject json(String key, Object value) {
        JSONObject result = new JSONObject();
        try { result.put(key, value); } catch (Exception ignored) { }
        return result;
    }
}
