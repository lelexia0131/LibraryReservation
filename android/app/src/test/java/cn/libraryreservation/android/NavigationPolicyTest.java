package cn.libraryreservation.android;

import org.junit.Test;
import static org.junit.Assert.*;

public class NavigationPolicyTest {
    @Test public void officialHostsOnlyAndLegacyUpgrade() {
        assertEquals("https://zjuam.zju.edu.cn/cas/login", NavigationPolicy.official("http://zjuam.zju.edu.cn/cas/login"));
        assertEquals("https://booking.lib.zju.edu.cn/h5/?cas=x", NavigationPolicy.official("http://booking.lib.zju.edu.cn:80/h5/?cas=x"));
        for (String url : new String[]{"file:///secret", "javascript:alert(1)", "intent://login", "https://evil.test/",
            "https://booking.lib.zju.edu.cn.evil.test/", "https://user@zjuam.zju.edu.cn/", "http://zjuam.zju.edu.cn:8080/", "https://zjuam.zju.edu.cn:444/"}) {
            assertNull(url, NavigationPolicy.official(url));
        }
    }
    @Test public void callbackIncludesHashAndIsNotAllowedForOtherOrigins() {
        for (String url : new String[]{"https://booking.lib.zju.edu.cn/?cas=synthetic", "https://booking.lib.zju.edu.cn/h5/#/cas?cas=synthetic%2Bvalue"}) assertTrue(NavigationPolicy.callback(url));
        for (String url : new String[]{"https://evil.test/?cas=synthetic", "http://booking.lib.zju.edu.cn/?cas=synthetic", "https://zjuam.zju.edu.cn/?cas=synthetic", "https://booking.lib.zju.edu.cn/?cas="}) assertFalse(NavigationPolicy.callback(url));
    }
    @Test public void remoteConfirmAndExchangeAlwaysBlocked() {
        for (String path : new String[]{"/api/Seat/confirm", "/api/Seat/%63onfirm/", "/api/seat/CONFIRM/extra", "/api/cas/user", "/api/cas/user/"}) assertTrue(NavigationPolicy.blocked("https://booking.lib.zju.edu.cn" + path));
        assertFalse(NavigationPolicy.blocked("https://booking.lib.zju.edu.cn/api/Seat/date"));
    }
}
