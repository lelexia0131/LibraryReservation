package cn.libraryreservation.android;

import android.webkit.CookieManager;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.UnknownHostException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLException;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

// Installed only in CoreRuntime; UI commands cannot access this transport or its Cookie jar.
final class AndroidCasHttpTransport {
    static okhttp3.OkHttpClient createClient() {
        // CAS may recover an unsent connection. Booking/confirm keeps its separate
        // no-retry client; the password body below remains one-shot after sending.
        return AndroidHttpTransport.createClient().newBuilder().retryOnConnectionFailure(true)
            .callTimeout(25, TimeUnit.SECONDS).connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).build();
    }
    static String failureCode(IOException error, boolean cancelled) {
        // OkHttp's total deadline also marks Call as cancelled.
        if (error instanceof InterruptedIOException) return "AUTH_TIMEOUT";
        if (cancelled) return "ERR_CANCELED";
        if (error instanceof SSLException) return "AUTH_TLS_FAILED";
        if (error instanceof UnknownHostException) return "AUTH_DNS_FAILED";
        return "ERR_NETWORK";
    }
    private final okhttp3.OkHttpClient client = createClient();
    private final Map<String, Call> calls = new ConcurrentHashMap<>();
    private static boolean allowed(HttpUrl url) {
        if (!url.scheme().equals("https") || url.port() != 443 || !url.username().isEmpty() || !url.password().isEmpty()) return false;
        if (url.host().equals("zjuam.zju.edu.cn")) {
            String service = url.queryParameter("service");
            return Set.of("/cas/login", "/cas/v2/getPubKey", "/cas/v2/getKaptchaStatus").contains(url.encodedPath())
                && (service == null || service.equals("https://booking.lib.zju.edu.cn/api/cas/cas"));
        }
        return url.host().equals("booking.lib.zju.edu.cn") && Set.of("/api/cas/cas", "/api/cas/user", "/h5/", "/h5/index.html").contains(url.encodedPath());
    }
    void request(JSONObject args, Consumer<JSONObject> done) throws Exception {
        HttpUrl url = HttpUrl.get(args.getString("url"));
        String method = args.getString("method"), id = args.getString("requestId");
        if (!allowed(url) || calls.containsKey(id) || !Set.of("GET", "POST").contains(method)) throw new Exception();
        Request.Builder request = new Request.Builder().url(url);
        boolean exchange = url.host().equals("booking.lib.zju.edu.cn") && url.encodedPath().equals("/api/cas/user");
        if (exchange) {
            JSONObject payload = new JSONObject(args.getString("body"));
            if (!method.equals("POST") || url.query() != null || payload.length() != 1 || !(payload.get("cas") instanceof String)) throw new Exception();
            request.header("X-Requested-With", "XMLHttpRequest").header("lang", "zh");
        }
        if (method.equals("POST")) {
            if (!exchange && (!url.host().equals("zjuam.zju.edu.cn") || !url.encodedPath().equals("/cas/login"))) throw new Exception();
            byte[] bytes = args.getString("body").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            request.header("Origin", "https://" + url.host()).post(new RequestBody() {
                @Override public MediaType contentType() { return MediaType.get(exchange ? "application/json" : "application/x-www-form-urlencoded"); }
                @Override public long contentLength() { return bytes.length; }
                @Override public boolean isOneShot() { return true; }
                @Override public void writeTo(okio.BufferedSink sink) throws IOException { sink.write(bytes); }
            });
        }
        CookieManager cookies = CookieManager.getInstance();
        String cookie = cookies.getCookie(url.toString());
        if (cookie != null) request.header("Cookie", cookie);
        Call call = client.newCall(request.build()); calls.put(id, call);
        call.enqueue(new Callback() {
            @Override public void onFailure(Call failed, IOException error) {
                calls.remove(id); done.accept(AndroidHttpTransport.json("code", failureCode(error, failed.isCanceled())));
            }
            @Override public void onResponse(Call completed, Response response) {
                try (response) {
                    for (String value : response.headers("Set-Cookie")) cookies.setCookie(url.toString(), value);
                    cookies.flush();
                    JSONObject result = new JSONObject().put("status", response.code())
                        .put("body", response.body() == null ? "" : response.body().string());
                    String location = response.header("Location");
                    if (location != null) result.put("location", location);
                    done.accept(result);
                } catch (Exception ignored) { done.accept(AndroidHttpTransport.json("code", "ERR_NETWORK")); }
                finally { calls.remove(id); }
            }
        });
    }
    void cancel(String id) { Call call = calls.get(id); if (call != null) call.cancel(); }
    void close() { client.dispatcher().cancelAll(); client.dispatcher().executorService().shutdown(); client.connectionPool().evictAll(); }
}
