package cn.libraryreservation.android;

import android.os.Bundle;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.MessageHandler;
import java.util.Set;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    CoreRuntime core;
    @Override public void onCreate(Bundle state) {
        registerPlugin(LibraryApplicationPlugin.class);
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled(false);
        core = new CoreRuntime(this);
    }
    @Override protected void load() {
        super.load();
        WebView view = bridge.getWebView();
        view.stopLoading();
        LockedWebView.configure(view);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                var url = request.getUrl();
                // Also blocks Capacitor's native HTTP proxy and file/content URL handlers.
                if (!"https".equals(url.getScheme()) || !"localhost".equals(url.getAuthority()) || url.getQuery() != null
                    || !Set.of("/", "/index.html", "/style.css", "/renderer.js", "/android-bridge.js").contains(url.getPath())) return LockedWebView.blocked();
                return super.shouldInterceptRequest(v, request);
            }
            @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail detail) {
                if (core != null) core.shutdown(); finish(); return true;
            }
        });
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) { return LockedWebView.blocked(); }
        });
        view.removeJavascriptInterface("CapacitorCookiesAndroidInterface");
        view.removeJavascriptInterface("CapacitorHttpAndroidInterface");
        view.removeJavascriptInterface("androidBridge");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(view, "androidBridge");
            // Keep Capacitor's response serialization but replace its unrestricted message ingress.
            MessageHandler handler = new MessageHandler(bridge, view, null);
            WebViewCompat.removeWebMessageListener(view, "androidBridge");
            view.removeJavascriptInterface("androidBridge");
            WebViewCompat.addWebMessageListener(view, "androidBridge", Set.of("https://localhost"), (v, message, origin, main, reply) -> {
                if (!main || !"https://localhost".equals(origin.toString())) return;
                try {
                    JSONObject data = new JSONObject(message.getData());
                    if (!data.has("type") && "LibraryApplication".equals(data.optString("pluginId")) && "invoke".equals(data.optString("methodName"))) {
                        handler.postMessage(message.getData());
                    } else if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                        reply.postMessage(new JSONObject().put("callbackId", data.optString("callbackId"))
                            .put("success", false).put("error", new JSONObject().put("message", "Forbidden")).toString());
                    }
                } catch (Exception ignored) { }
            });
        } else { finish(); return; }
        bridge.reload();
    }
    @Override public void onResume() { super.onResume(); if (core != null) core.foreground(true); }
    @Override public void onStop() { if (core != null) core.foreground(false); super.onStop(); }
    @Override public void onDestroy() { if (core != null) core.shutdown(); super.onDestroy(); }
}
