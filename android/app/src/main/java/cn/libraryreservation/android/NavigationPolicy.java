package cn.libraryreservation.android;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Set;

final class NavigationPolicy {
    private static final Set<String> HOSTS = Set.of("booking.lib.zju.edu.cn", "zjuam.zju.edu.cn");
    static String official(String value) {
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            if (uri.getRawUserInfo() != null || !HOSTS.contains(uri.getHost())) return null;
            if ("https".equals(scheme) && (uri.getPort() == -1 || uri.getPort() == 443)) return value;
            if ("http".equals(scheme) && (uri.getPort() == -1 || uri.getPort() == 80)) {
                return "https://" + uri.getHost() + (uri.getRawPath().isEmpty() ? "/" : uri.getRawPath())
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery())
                    + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
            }
        } catch (Exception ignored) { }
        return null;
    }
    static boolean blocked(String value) {
        try {
            String path = new URI(value).getPath().replaceAll("/+$", "").toLowerCase(java.util.Locale.ROOT);
            return path.matches(".*/api/seat/confirm(?:/.*)?") || path.equals("/api/cas/user");
        } catch (Exception ignored) { return true; }
    }
    static boolean callback(String value) {
        try {
            URI uri = new URI(value);
            if (!value.equals(official(value)) || !"booking.lib.zju.edu.cn".equals(uri.getHost())) return false;
            String fragment = uri.getRawFragment();
            return casParameter(uri.getRawQuery()) || (fragment != null && fragment.contains("?")
                && casParameter(fragment.substring(fragment.indexOf('?') + 1)));
        } catch (Exception ignored) { return false; }
    }
    private static boolean casParameter(String query) throws Exception {
        if (query == null) return false;
        for (String item : query.split("&")) {
            String[] parts = item.split("=", 2);
            if (parts.length == 2 && "cas".equals(URLDecoder.decode(parts[0], StandardCharsets.UTF_8.name()))
                && !URLDecoder.decode(parts[1], StandardCharsets.UTF_8.name()).isEmpty()) return true;
        }
        return false;
    }
}
