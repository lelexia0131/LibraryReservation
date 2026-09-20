package cn.libraryreservation.android;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.json.JSONObject;

// Not a Capacitor plugin. No instance or method of this class is installed into the UI WebView.
public final class CoreRuntime {
    static final String PRIVATE_ORIGIN = "https://private-core.invalid";
    static final String PRIVATE_BASE_URL = PRIVATE_ORIGIN + "/";
    static final String PRIVATE_ASSET = "private-core.js";
    static final long STARTUP_TIMEOUT_MS = 10000;
    private final Activity activity;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView core;
    private AndroidSecureTokenStore store;
    private final AndroidHttpTransport http = new AndroidHttpTransport();
    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private record PendingCall(String command, Consumer<JSONObject> done) { }
    private final Map<String, PendingCall> replies = new HashMap<>();
    private final Map<String, Runnable> queued = new HashMap<>();
    private AndroidCasBrowser cas;
    private int next;
    private boolean ready, closed, stopping, foreground = true;
    private boolean bridgeRegistered;
    private final AtomicBoolean initialDocumentPending = new AtomicBoolean(true);
    private String stage = "create";
    private final Runnable startupTimer = () -> {
        if (closed || ready) return;
        Log.e("CoreRuntime", "[CoreRuntime] startupTimeout stage=" + stage);
        startupFailed("READY_TIMEOUT");
    };
    CoreRuntime(Activity activity) {
        this.activity = activity;
        logStage("create");
        try {
            stage = "featureCheck";
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                Log.i("CoreRuntime", "[CoreRuntime] WEB_MESSAGE_LISTENER supported=true");
                Log.i("CoreRuntime", "[CoreRuntime] featureCheck webMessageListener=true");
                stage = "secureStoreCreate";
                store = new AndroidSecureTokenStore(activity);
                stage = "privateWebViewCreate";
                core = new WebView(activity);
                LockedWebView.configure(core);
                core.getSettings().setBlockNetworkLoads(true);
                core.getSettings().setDomStorageEnabled(false);
                core.setWebViewClient(new WebViewClient() {
                    @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                        if (closed) return;
                        initialDocumentPending.set(false);
                        stage = "privatePageStarted";
                        Log.i("CoreRuntime", "[CoreRuntime] privatePageStarted origin=" + PRIVATE_ORIGIN);
                    }
                    @Override public void onPageFinished(WebView v, String url) {
                        if (closed) return;
                        if (!ready) stage = "privatePageFinished";
                        Log.i("CoreRuntime", "[CoreRuntime] privatePageFinished");
                        v.evaluateJavascript("location.origin !== '" + PRIVATE_ORIGIN + "' ? 'ORIGIN_MISMATCH' : "
                            + "typeof NativeCore === 'undefined' || typeof NativeCore.postMessage !== 'function' ? 'NATIVE_CORE_MISSING' : "
                            + "document.scripts.length === 0 ? 'PRIVATE_DOCUMENT_EMPTY' : "
                            + "typeof TrustedCore === 'undefined' ? 'PRIVATE_CORE_NOT_STARTED' : 'OK'", state -> {
                            if (ready || closed) return;
                            switch (state) {
                                case "\"ORIGIN_MISMATCH\"": startupFailed("ORIGIN_MISMATCH"); break;
                                case "\"NATIVE_CORE_MISSING\"": startupFailed("NATIVE_CORE_MISSING"); break;
                                case "\"PRIVATE_DOCUMENT_EMPTY\"": startupFailed("PRIVATE_DOCUMENT_EMPTY"); break;
                                case "\"PRIVATE_CORE_NOT_STARTED\"": startupFailed("PRIVATE_CORE_NOT_STARTED"); break;
                                default: break;
                            }
                        });
                    }
                    @Override public void onReceivedError(WebView v, WebResourceRequest r, android.webkit.WebResourceError error) {
                        if (r.isForMainFrame() && !ready) ui.post(() -> startupFailed("PRIVATE_DOCUMENT_LOAD_FAILED"));
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
                    @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                        // loadDataWithBaseURL uses an internal data: transport, including on Huawei 114.
                        // Let only the initial inline main document load. Its security origin is PRIVATE_BASE_URL,
                        // not data:; replacing it with a 403 discards the script and the intended origin.
                        if (r.isForMainFrame() && "data".equals(r.getUrl().getScheme())
                            && initialDocumentPending.compareAndSet(true, false)) return null;
                        return LockedWebView.blocked();
                    }
                    @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail detail) {
                        if (!ready) startupFailed("RENDER_PROCESS_GONE"); else destroy(); return true;
                    }
                });
                stage = "nativeBridgeRegistration";
                Port port = new Port();
                WebViewCompat.addWebMessageListener(core, "NativeCore", Set.of(PRIVATE_ORIGIN), (v, message, origin, main, reply) -> {
                    if (closed || !main || !PRIVATE_ORIGIN.equals(origin.toString())) return;
                    try {
                        JSONObject data = new JSONObject(message.getData());
                        switch (data.getString("type")) {
                            case "ready": port.ready(); break;
                            case "reply": if (ready) port.reply(data.getString("id"), data.getString("message")); break;
                            case "request": if (ready) port.request(data.toString()); break;
                            case "startupFailed": if (!ready) startupFailed("PRIVATE_CORE_SCRIPT_ERROR"); break;
                            default: if (!ready) startupFailed("INVALID_STARTUP_MESSAGE");
                        }
                    } catch (Exception ignored) { if (!ready) startupFailed("INVALID_STARTUP_MESSAGE"); }
                });
                bridgeRegistered = true;
                logStage("nativeBridgeRegistered");
                stage = "privateAssetRead";
                String script;
                try (var stream = activity.getAssets().open(PRIVATE_ASSET); var bytes = new java.io.ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
                    script = bytes.toString(StandardCharsets.UTF_8.name());
                } catch (java.io.IOException ignored) { startupFailed("PRIVATE_CORE_ASSET_MISSING"); return; }
                if (script.trim().isEmpty()) { startupFailed("PRIVATE_CORE_ASSET_MISSING"); return; }
                // Unique origin, no opener/frame relation to the UI, no remote content and no persistent browser storage.
                logStage("loadingPrivateDocument");
                ui.postDelayed(startupTimer, STARTUP_TIMEOUT_MS);
                core.loadDataWithBaseURL(PRIVATE_BASE_URL, "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\"><script>"
                    + "window.addEventListener('error',function(){if(typeof NativeCore!=='undefined')NativeCore.postMessage('{\"type\":\"startupFailed\"}');});</script><script>"
                    + script.replace("</script", "<\\/script") + "</script>", "text/html", "UTF-8", PRIVATE_BASE_URL);
            } else {
                Log.i("CoreRuntime", "[CoreRuntime] WEB_MESSAGE_LISTENER supported=false");
                Log.i("CoreRuntime", "[CoreRuntime] featureCheck webMessageListener=false");
                startupFailed("WEB_MESSAGE_LISTENER_UNSUPPORTED");
            }
        } catch (Exception ignored) { startupFailed("INITIALIZATION_FAILED"); }
    }
    private void logStage(String value) { stage = value; Log.i("CoreRuntime", "[CoreRuntime] " + value); }
    private void startupFailed(String reason) {
        if (closed || ready) return;
        Log.e("CoreRuntime", "[CoreRuntime] startupFailed stage=" + stage + " reason=" + reason);
        destroy();
    }
    void invoke(String command, Object input, Consumer<JSONObject> done) {
        if (closed || stopping || replies.size() >= 64) { done.accept(failure(command)); return; }
        String id = String.valueOf(++next);
        replies.put(id, new PendingCall(command, done));
        Runnable task = () -> evaluate("TrustedCore.dispatch(" + JSONObject.quote(id) + "," + JSONObject.quote(command) + ",JSON.parse(" + JSONObject.quote(input == null ? "null" : input.toString()) + "))");
        if (ready) task.run(); else queued.put(id, task);
    }
    void foreground(boolean value) {
        foreground = value;
        if (ready) evaluate(value ? "TrustedCore.resume()" : "TrustedCore.suspend()");
    }
    void shutdown() {
        if (closed || stopping) return;
        stopping = true;
        if (ready) evaluate("TrustedCore.shutdown()"); else destroy();
        ui.postDelayed(this::destroy, 10000);
    }
    private void evaluate(String script) { if (!closed) core.evaluateJavascript(script, null); }
    private void resolved(String id, Object value, String error) {
        JSONObject result = AndroidHttpTransport.json("ok", error == null);
        try { result.put(error == null ? "value" : "code", error == null ? (value == null ? JSONObject.NULL : value) : error); } catch (Exception ignored) { }
        ui.post(() -> evaluate("TrustedCore.resolve(" + JSONObject.quote(id) + "," + result + ")"));
    }
    private void event(JSONObject event) { ui.post(() -> evaluate("TrustedCore.event(" + event + ")")); }
    private void destroy() {
        if (closed) return;
        closed = true;
        initialDocumentPending.set(false);
        ui.removeCallbacks(startupTimer);
        if (cas != null) cas.close();
        http.close(); storage.shutdown(); queued.clear();
        for (var reply : replies.values()) reply.done().accept(failure(reply.command()));
        replies.clear();
        if (core != null) {
            if (bridgeRegistered && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.removeWebMessageListener(core, "NativeCore");
            }
            core.destroy();
        }
    }
    static JSONObject failure(String command) {
        JSONObject error = AndroidHttpTransport.json("code", "reservation:manual".equals(command) ? "CONFIRM_OUTCOME_UNKNOWN" : "NATIVE_UNAVAILABLE");
        try { error.put("message", "reservation:manual".equals(command) ? "预约结果未知，请在图书馆官网确认。" : "无法连接应用，请重新打开。");
            return new JSONObject().put("ok", false).put("error", error);
        } catch (Exception ignored) { return new JSONObject(); }
    }
    private final class Port {
        void ready() {
            if (closed || ready) return;
            Log.i("CoreRuntime", "[CoreRuntime] nativeCoreMessageReceived type=ready");
            ready = true;
            ui.removeCallbacks(startupTimer);
            logStage("ready");
            foreground(foreground);
            for (Runnable task : queued.values()) task.run();
            queued.clear();
        }
        void reply(String id, String message) {
            ui.post(() -> {
                if ("shutdown".equals(id)) { destroy(); return; }
                PendingCall call = replies.remove(id);
                if (call != null) { try { call.done().accept(new JSONObject(message)); } catch (Exception ignored) { call.done().accept(failure(call.command())); } }
            });
        }
        void request(String message) {
            ui.post(() -> {
                if (closed) return;
                String id = "";
                try {
                    JSONObject request = new JSONObject(message);
                    id = request.getString("id");
                    String method = request.getString("method");
                    JSONObject args = request.getJSONObject("args");
                    final String requestId = id;
                    switch (method) {
                        case "http": http.post(args, result -> resolved(requestId, result, null)); return;
                        case "httpCancel": http.cancel(args.getString("requestId")); break;
                        case "storeGet": case "storeSet": case "storeClear":
                            storage.execute(() -> {
                                try {
                                    Object result = null;
                                    if (method.equals("storeGet")) result = store.get();
                                    else if (method.equals("storeSet")) store.set(args); else store.clear();
                                    resolved(requestId, result, null);
                                } catch (Exception ignored) { resolved(requestId, null, method.equals("storeGet") ? "TOKEN_STORE_READ_FAILED" : method.equals("storeSet") ? "TOKEN_STORE_WRITE_FAILED" : "TOKEN_STORE_CLEAR_FAILED"); }
                            }); return;
                        case "casCreate":
                            if (cas != null) cas.close();
                            cas = new AndroidCasBrowser(activity, args.getString("id"), CoreRuntime.this::event); break;
                        case "casLoad": requireCas(args).load(args.getString("url")); break;
                        case "casShow": requireCas(args).show(); break;
                        case "casClose": requireCas(args).close(); cas = null; break;
                        case "casClear":
                            if (cas != null) { cas.close(); cas = null; }
                            AndroidCasBrowser.clear(() -> resolved(requestId, null, null)); return;
                        case "openWebsite": activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://booking.lib.zju.edu.cn/h5/index.html"))); break;
                        default: throw new Exception();
                    }
                    resolved(id, null, null);
                } catch (Exception ignored) { resolved(id, null, "NATIVE_UNAVAILABLE"); }
            });
        }
    }
    private AndroidCasBrowser requireCas(JSONObject args) throws Exception {
        if (cas == null || !cas.id.equals(args.getString("id"))) throw new Exception();
        return cas;
    }
}
