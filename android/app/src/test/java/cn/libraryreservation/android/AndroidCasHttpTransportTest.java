package cn.libraryreservation.android;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.UnknownHostException;
import javax.net.ssl.SSLHandshakeException;
import org.junit.Test;
import static org.junit.Assert.*;

public class AndroidCasHttpTransportTest {
    @Test public void authenticationCanRecoverConnectionsWithoutChangingBookingClient() {
        var auth = AndroidCasHttpTransport.createClient();
        var booking = AndroidHttpTransport.createClient();
        try {
            assertTrue(auth.retryOnConnectionFailure());
            assertEquals(25000, auth.callTimeoutMillis());
            assertEquals(12000, auth.readTimeoutMillis());
            assertFalse(auth.followRedirects()); assertFalse(auth.followSslRedirects());
            assertFalse(booking.retryOnConnectionFailure());
            assertEquals(8000, booking.callTimeoutMillis());
            assertTrue(AndroidHttpTransport.oneShotBody("{}").isOneShot());
        } finally {
            auth.dispatcher().executorService().shutdown(); auth.connectionPool().evictAll();
            booking.dispatcher().executorService().shutdown(); booking.connectionPool().evictAll();
        }
    }
    @Test public void failuresHaveFixedCodesWithoutExceptionDetails() {
        assertEquals("AUTH_TLS_FAILED", AndroidCasHttpTransport.failureCode(new SSLHandshakeException("private"), false));
        assertEquals("AUTH_DNS_FAILED", AndroidCasHttpTransport.failureCode(new UnknownHostException("private"), false));
        assertEquals("AUTH_TIMEOUT", AndroidCasHttpTransport.failureCode(new InterruptedIOException("private"), false));
        assertEquals("AUTH_TIMEOUT", AndroidCasHttpTransport.failureCode(new InterruptedIOException("private"), true));
        assertEquals("ERR_NETWORK", AndroidCasHttpTransport.failureCode(new IOException("private"), false));
        assertEquals("ERR_CANCELED", AndroidCasHttpTransport.failureCode(new IOException("private"), true));
    }
}
