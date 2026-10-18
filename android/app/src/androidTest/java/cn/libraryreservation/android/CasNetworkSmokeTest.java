package cn.libraryreservation.android;

import android.os.Build;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.AfterClass;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

// Opt-in, public GET-only device check. A separate WebView data directory prevents
// access to the user's CAS Cookies. No Activity, auth manager, credentials or booking.
@RunWith(AndroidJUnit4.class)
public class CasNetworkSmokeTest {
    private static WebView view;
    @BeforeClass public static void isolateCookies() {
        assumeTrue(Build.VERSION.SDK_INT >= 28);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView.setDataDirectorySuffix("public-cas-network-test");
            view = new WebView(InstrumentationRegistry.getInstrumentation().getTargetContext());
        });
    }
    @AfterClass public static void closeView() {
        if (view != null) InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.destroy());
    }
    @Test public void publicNativeCasTransport() throws Exception {
        var transport = new AndroidCasHttpTransport();
        try {
            String url = "https://booking.lib.zju.edu.cn/api/cas/cas";
            JSONObject entry = get(transport, url);
            assertEquals(302, entry.getInt("status"));
            url = entry.getString("location").replace("http://zjuam.zju.edu.cn:80/", "https://zjuam.zju.edu.cn/")
                .replace("http://zjuam.zju.edu.cn/", "https://zjuam.zju.edu.cn/");
            assertTrue(url.startsWith("https://zjuam.zju.edu.cn/cas/login?"));
            JSONObject login = get(transport, url);
            assertEquals(200, login.getInt("status"));
            assertTrue(login.getString("body").contains("name=\"execution\""));
            assertEquals(200, get(transport, "https://zjuam.zju.edu.cn/cas/v2/getKaptchaStatus").getInt("status"));
            assertEquals(200, get(transport, "https://zjuam.zju.edu.cn/cas/v2/getPubKey").getInt("status"));
        } finally { transport.close(); }
    }
    private JSONObject get(AndroidCasHttpTransport transport, String url) throws Exception {
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<Exception> setupError = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        var args = new JSONObject().put("requestId", "public-get").put("url", url).put("method", "GET");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            try { transport.request(args, value -> { result.set(value); done.countDown(); }); }
            catch (Exception error) { setupError.set(error); done.countDown(); }
        });
        assertTrue("native request did not settle", done.await(30, TimeUnit.SECONDS));
        assertNull("native setup failed: " + (setupError.get() == null ? "" : setupError.get().getClass().getSimpleName()), setupError.get());
        assertFalse("native response failed: " + result.get().optString("code"), result.get().has("code"));
        return result.get();
    }
}
