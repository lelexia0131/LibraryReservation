package cn.libraryreservation.android;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.http.SslError;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.json.JSONObject;

final class AndroidCasBrowser {
    final WebView view;
    final String id;
    private final Activity owner;
    private final Consumer<JSONObject> events;
    private final AtomicBoolean captured = new AtomicBoolean();
    private boolean closed;
    CasActivity activity;
    AndroidCasBrowser(Activity owner, String id, Consumer<JSONObject> events) {
        this.owner = owner; this.id = id; this.events = events;
        view = new WebView(owner);
        LockedWebView.configure(view);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        if (android.os.Build.VERSION.SDK_INT >= 26) view.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                return navigate(request.getUrl().toString(), request.isForMainFrame());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                String url = request.getUrl().toString(), official = NavigationPolicy.official(url);
                if (official == null || !official.equals(url) || NavigationPolicy.blocked(url)) return LockedWebView.blocked();
                if (NavigationPolicy.callback(url)) {
                    if (request.isForMainFrame()) capture(url);
                    return LockedWebView.blocked();
                }
                return null;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap icon) { navigate(url, true); }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) {
                // Hash callbacks have no network request. Remote credential exchange remains blocked above.
                navigate(url, true);
            }
            @Override public void onReceivedSslError(WebView v, SslErrorHandler handler, SslError error) { handler.cancel(); event("failed", null); }
            @Override public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !captured.get()) event("failed", null);
            }
            @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail detail) { event("failed", null); close(); return true; }
        });
    }
    private boolean navigate(String url, boolean main) {
        String official = NavigationPolicy.official(url);
        if (official == null || NavigationPolicy.blocked(url)) { view.stopLoading(); if (main) event("failed", null); return true; }
        if (!official.equals(url)) { if (main) view.loadUrl(official); return true; }
        if (NavigationPolicy.callback(url)) { if (main) capture(url); return true; }
        if (main && !captured.get()) event("navigation", url);
        return captured.get();
    }
    private void capture(String url) {
        if (captured.compareAndSet(false, true)) owner.runOnUiThread(() -> { view.stopLoading(); event("navigation", url); });
    }
    private void event(String kind, String url) {
        if (closed) return;
        JSONObject event = AndroidHttpTransport.json("id", id);
        try { event.put("kind", kind); if (url != null) event.put("url", url); } catch (Exception ignored) { }
        events.accept(event);
    }
    void load(String url) throws Exception {
        if (!"https://booking.lib.zju.edu.cn/api/cas/cas".equals(url)) throw new Exception();
        view.loadUrl(url);
    }
    void show() {
        if (closed || captured.get() || activity != null) return;
        CasActivity.pending = new java.lang.ref.WeakReference<>(this);
        owner.startActivity(new Intent(owner, CasActivity.class));
    }
    void cancel() { event("closed", null); close(); }
    void close() {
        if (closed) return;
        closed = true;
        if (CasActivity.pending.get() == this) CasActivity.pending.clear();
        if (activity != null) { activity.finish(); activity = null; }
        if (view.getParent() instanceof android.view.ViewGroup parent) parent.removeView(view);
        view.stopLoading(); view.clearHistory(); view.destroy();
    }
    static void clear(Runnable done) {
        WebStorage.getInstance().deleteAllData();
        CookieManager.getInstance().removeAllCookies(removed -> { CookieManager.getInstance().flush(); done.run(); });
    }
}
