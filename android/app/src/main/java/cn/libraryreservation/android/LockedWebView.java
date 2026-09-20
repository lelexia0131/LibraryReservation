package cn.libraryreservation.android;

import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.io.ByteArrayInputStream;

final class LockedWebView {
    static WebResourceResponse blocked() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", java.util.Map.of(), new ByteArrayInputStream(new byte[0])); }
    static void configure(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(true);
        settings.setSaveFormData(false); settings.setMediaPlaybackRequiresUserGesture(true);
        view.setDownloadListener((url, agent, disposition, type, length) -> { });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
            @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean gesture, android.os.Message message) { return false; }
            @Override public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<android.net.Uri[]> callback, FileChooserParams params) { callback.onReceiveValue(null); return true; }
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) { return true; }
        });
    }
}
