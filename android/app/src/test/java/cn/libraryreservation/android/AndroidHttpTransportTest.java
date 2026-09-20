package cn.libraryreservation.android;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Request;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.SocketPolicy;
import org.junit.Test;
import static org.junit.Assert.*;

public class AndroidHttpTransportTest {
    @Test public void followUpsNeverReplayTheActualProductionRequestBody() throws Exception {
        for (int status : new int[]{503, 408, 307, 401, 429}) {
            try (MockWebServer server = new MockWebServer()) {
                server.start();
                server.enqueue(new MockResponse().setResponseCode(status).addHeader("Retry-After", "0").addHeader("Location", "/replayed"));
                server.enqueue(new MockResponse().setResponseCode(200));
                var client = AndroidHttpTransport.createClient();
                try (var response = client.newCall(new Request.Builder().url(server.url("/api/Seat/confirm"))
                    .post(AndroidHttpTransport.oneShotBody("{\"synthetic\":\"中文\"}")).build()).execute()) {
                    assertEquals(status, response.code());
                    assertEquals(1, server.getRequestCount());
                    var request = server.takeRequest();
                    assertEquals("{\"synthetic\":\"中文\"}", request.getBody().readUtf8());
                    assertNull(request.getHeader("Cookie"));
                } finally { client.connectionPool().evictAll(); client.dispatcher().executorService().shutdown(); }
            }
        }
    }
    @Test public void lostResponseAndTimeoutDoNotReplay() throws Exception {
        for (SocketPolicy policy : new SocketPolicy[]{SocketPolicy.DISCONNECT_AFTER_REQUEST, SocketPolicy.NO_RESPONSE}) {
            try (MockWebServer server = new MockWebServer()) {
                server.start(); server.enqueue(new MockResponse().setSocketPolicy(policy));
                server.enqueue(new MockResponse().setResponseCode(200));
                var client = AndroidHttpTransport.createClient().newBuilder().callTimeout(500, TimeUnit.MILLISECONDS).build();
                try {
                    assertThrows(IOException.class, () -> client.newCall(new Request.Builder().url(server.url("/api/Seat/confirm"))
                        .post(AndroidHttpTransport.oneShotBody("{}" )).build()).execute());
                    assertEquals(1, server.getRequestCount());
                } finally { client.connectionPool().evictAll(); client.dispatcher().executorService().shutdown(); }
            }
        }
    }
}
