package cn.libraryreservation.android;

import android.app.Activity;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.mockito.MockedConstruction;
import org.mockito.MockedStatic;
import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

public class CoreRuntimeTest {
    // Exercise the production runtime with Android edges mocked; no device credentials or network.
    private static final class Harness implements AutoCloseable {
        final MockedStatic<Log> log = mockStatic(Log.class);
        final MockedStatic<Looper> looper = mockStatic(Looper.class);
        final MockedStatic<WebViewFeature> feature = mockStatic(WebViewFeature.class);
        final MockedStatic<Uri> uri = mockStatic(Uri.class);
        final MockedStatic<WebViewCompat> compat = mockStatic(WebViewCompat.class);
        final MockedConstruction<AndroidSecureTokenStore> store = mockConstruction(AndroidSecureTokenStore.class);
        final MockedConstruction<AndroidHttpTransport> http = mockConstruction(AndroidHttpTransport.class);
        final MockedConstruction<WebResourceResponse> responses = mockConstruction(WebResourceResponse.class);
        final List<Runnable> timers = new ArrayList<>();
        final List<String> order = new ArrayList<>();
        WebViewClient client;
        final MockedConstruction<Handler> handlers = mockConstruction(Handler.class, (handler, context) -> {
            when(handler.post(any())).thenAnswer(call -> { ((Runnable) call.getArgument(0)).run(); return true; });
            when(handler.postDelayed(any(), anyLong())).thenAnswer(call -> {
                assertEquals(CoreRuntime.STARTUP_TIMEOUT_MS, (long) call.getArgument(1));
                timers.add(call.getArgument(0)); return true;
            });
        });
        final MockedConstruction<WebView> views = mockConstruction(WebView.class, (view, context) -> {
            when(view.getSettings()).thenReturn(mock(WebSettings.class));
            doAnswer(call -> { client = call.getArgument(0); return null; }).when(view).setWebViewClient(any());
            doAnswer(call -> {
                order.add("load");
                assertEquals(List.of("register", "load"), order);
                assertEquals(CoreRuntime.PRIVATE_BASE_URL, call.getArgument(0));
                assertEquals(CoreRuntime.PRIVATE_BASE_URL, call.getArgument(4));
                assertTrue(((String) call.getArgument(1)).contains("syntheticPrivateCore"));
                return null;
            }).when(view).loadDataWithBaseURL(anyString(), anyString(), anyString(), anyString(), anyString());
        });
        final Activity activity = mock(Activity.class);
        final AssetManager assets = mock(AssetManager.class);
        WebViewCompat.WebMessageListener listener;
        CoreRuntime runtime;
        Harness() throws Exception {
            feature.when(() -> WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)).thenReturn(true);
            compat.when(() -> WebViewCompat.addWebMessageListener(any(), eq("NativeCore"), anySet(), any())).thenAnswer(call -> {
                order.add("register");
                assertEquals(Set.of(CoreRuntime.PRIVATE_ORIGIN), call.getArgument(2));
                listener = call.getArgument(3); return null;
            });
            when(activity.getAssets()).thenReturn(assets);
            when(assets.open(CoreRuntime.PRIVATE_ASSET)).thenReturn(new ByteArrayInputStream("syntheticPrivateCore();".getBytes()));
        }
        void start() { runtime = new CoreRuntime(activity); }
        void message(String origin, boolean main, String data) {
            Uri uri = mock(Uri.class); when(uri.toString()).thenReturn(origin);
            WebMessageCompat message = mock(WebMessageCompat.class); when(message.getData()).thenReturn(data);
            listener.onPostMessage(views.constructed().get(0), message, uri, main, null);
        }
        JSONObject failedCall(String command) {
            AtomicReference<JSONObject> result = new AtomicReference<>();
            runtime.invoke(command, null, result::set);
            return result.get();
        }
        WebResourceResponse intercept(String scheme, boolean main) {
            Uri uri = mock(Uri.class); when(uri.getScheme()).thenReturn(scheme);
            WebResourceRequest request = mock(WebResourceRequest.class);
            when(request.getUrl()).thenReturn(uri); when(request.isForMainFrame()).thenReturn(main);
            return client.shouldInterceptRequest(views.constructed().get(0), request);
        }
        @Override public void close() {
            if (runtime != null) runtime.shutdown();
            views.close(); handlers.close(); responses.close(); http.close(); store.close(); compat.close(); uri.close(); feature.close(); looper.close(); log.close();
        }
    }
    @Test public void httpsDocumentOriginExactlyMatchesAllowedOrigin() {
        URI base = URI.create(CoreRuntime.PRIVATE_BASE_URL);
        assertEquals("https", base.getScheme());
        assertNotNull(base.getHost()); assertFalse(base.getHost().isEmpty());
        assertNull(base.getUserInfo()); assertNull(base.getQuery()); assertNull(base.getFragment());
        assertEquals(CoreRuntime.PRIVATE_ORIGIN, base.getScheme() + "://" + base.getAuthority());
    }
    @Test public void listenerPrecedesDocumentAndReadyReleasesQueuedCallsOnce() throws Exception {
        try (Harness h = new Harness()) {
            h.start();
            assertEquals(List.of("register", "load"), h.order);
            h.runtime.invoke("auth:get-status", null, ignored -> {});
            WebView view = h.views.constructed().get(0);
            verify(view, never()).evaluateJavascript(anyString(), any());
            h.message(CoreRuntime.PRIVATE_ORIGIN, true, "{\"type\":\"ready\"}");
            h.message(CoreRuntime.PRIVATE_ORIGIN, true, "{\"type\":\"ready\"}");
            verify(view, times(1)).evaluateJavascript(startsWith("TrustedCore.dispatch("), isNull());
            h.timers.get(0).run();
            verify(view, never()).destroy();
            verify(h.handlers.constructed().get(0)).removeCallbacks(h.timers.get(0));
        }
    }
    @Test public void initialInlineTransportIsNotReplacedWith403AndAllOtherRequestsStayBlocked() throws Exception {
        try (Harness h = new Harness()) {
            h.start();
            assertNotNull(h.intercept("https", true));
            assertNotNull(h.intercept("data", false));
            assertNull(h.intercept("data", true));
            assertNotNull(h.intercept("data", true));
            for (String scheme : new String[]{"https", "http", "file", "content", "about"}) {
                assertNotNull(h.intercept(scheme, true));
                assertNotNull(h.intercept(scheme, false));
            }
        }
    }
    @Test public void pageStartClosesInlineTransportGateEvenIfProviderDoesNotInterceptInitialData() throws Exception {
        try (Harness h = new Harness()) {
            h.start();
            h.client.onPageStarted(h.views.constructed().get(0), CoreRuntime.PRIVATE_BASE_URL, null);
            assertNotNull(h.intercept("data", true));
        }
    }
    @Test public void absentReadyTimesOutAndSettlesAllPendingCalls() throws Exception {
        try (Harness h = new Harness()) {
            h.start();
            List<JSONObject> results = new ArrayList<>();
            h.runtime.invoke("auth:login", null, results::add);
            h.runtime.invoke("booking:open-web", null, results::add);
            h.runtime.invoke("reservation:manual", null, results::add);
            assertTrue(results.isEmpty());
            h.timers.get(0).run();
            assertEquals(3, results.size());
            assertEquals(2, results.stream().filter(r -> "NATIVE_UNAVAILABLE".equals(r.optJSONObject("error").optString("code"))).count());
            assertEquals(1, results.stream().filter(r -> "CONFIRM_OUTCOME_UNKNOWN".equals(r.optJSONObject("error").optString("code"))).count());
            h.message(CoreRuntime.PRIVATE_ORIGIN, true, "{\"type\":\"ready\"}");
            verify(h.views.constructed().get(0), never()).evaluateJavascript(startsWith("TrustedCore.dispatch("), any());
            verify(h.views.constructed().get(0), times(1)).destroy();
            h.log.verify(() -> Log.e("CoreRuntime", "[CoreRuntime] startupTimeout stage=loadingPrivateDocument"));
            assertNotNull(h.failedCall("auth:login"));
        }
    }
    @Test public void unsupportedFeatureNeverCreatesPrivateWebView() throws Exception {
        try (Harness h = new Harness()) {
            h.feature.when(() -> WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)).thenReturn(false);
            h.start();
            assertTrue(h.views.constructed().isEmpty()); assertTrue(h.order.isEmpty()); assertTrue(h.timers.isEmpty());
            assertNotNull(h.failedCall("auth:login"));
            h.log.verify(() -> Log.i("CoreRuntime", "[CoreRuntime] WEB_MESSAGE_LISTENER supported=false"));
            h.log.verify(() -> Log.e("CoreRuntime", "[CoreRuntime] startupFailed stage=featureCheck reason=WEB_MESSAGE_LISTENER_UNSUPPORTED"));
        }
    }
    @Test public void absentOrEmptyAssetNeverLoadsDocument() throws Exception {
        for (boolean missing : new boolean[]{true, false}) {
            try (Harness h = new Harness()) {
                if (missing) when(h.assets.open(CoreRuntime.PRIVATE_ASSET)).thenThrow(new FileNotFoundException("untrusted secret"));
                else when(h.assets.open(CoreRuntime.PRIVATE_ASSET)).thenReturn(new ByteArrayInputStream(new byte[0]));
                h.start();
                assertEquals(List.of("register"), h.order); assertTrue(h.timers.isEmpty());
                assertNotNull(h.failedCall("booking:open-web"));
                verify(h.views.constructed().get(0)).destroy();
                h.log.verify(() -> Log.e("CoreRuntime", "[CoreRuntime] startupFailed stage=privateAssetRead reason=PRIVATE_CORE_ASSET_MISSING"));
            }
        }
    }
    @Test public void foreignOriginAndSubframeCannotBecomeReadyOrReachNativeServices() throws Exception {
        try (Harness h = new Harness()) {
            h.start();
            for (String origin : new String[]{"https://localhost", "https://private-core.invalid.evil.test", "null", "http://private-core.invalid"}) {
                h.message(origin, true, "{\"type\":\"ready\"}");
            }
            h.message(CoreRuntime.PRIVATE_ORIGIN, false, "{\"type\":\"ready\"}");
            h.message(CoreRuntime.PRIVATE_ORIGIN, true, "{\"type\":\"request\",\"id\":\"1\",\"method\":\"storeGet\",\"args\":{}}");
            verifyNoInteractions(h.store.constructed().get(0));
            h.timers.get(0).run();
            verify(h.views.constructed().get(0)).destroy();
        }
    }
    @Test public void startupErrorUsesFixedCodeAndDoesNotEchoUntrustedMessage() throws Exception {
        try (Harness h = new Harness()) {
            h.start();
            h.message(CoreRuntime.PRIVATE_ORIGIN, true, "{\"type\":\"startupFailed\",\"reason\":\"untrusted secret\"}");
            assertNotNull(h.failedCall("auth:login"));
            h.log.verify(() -> Log.e("CoreRuntime", "[CoreRuntime] startupFailed stage=loadingPrivateDocument reason=PRIVATE_CORE_SCRIPT_ERROR"));
        }
    }
}
