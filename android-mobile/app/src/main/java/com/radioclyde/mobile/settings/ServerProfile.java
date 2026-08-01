package com.radioclyde.mobile.settings;

/**
 * One of the two server connection profiles a listener can configure:
 * Internal (the station's trusted LAN -- src/server/auth.js skips its auth
 * hook entirely for requests from config.web.trustedNetworks, so no
 * credentials are needed) or External (everywhere else -- the auth hook is
 * enforced there). Immutable; a fresh instance is read from ProfileRepository
 * each time, never mutated in place.
 */
public final class ServerProfile {

    public enum Id { INTERNAL, EXTERNAL }

    public final Id id;
    public final String scheme; // "http" or "https"
    public final String host;
    public final String port; // "" for EXTERNAL -- always the scheme's standard port (443/80), never entered
    public final String username; // "" for INTERNAL
    public final String password; // "" for INTERNAL

    public ServerProfile(Id id, String scheme, String host, String port, String username, String password) {
        this.id = id;
        this.scheme = scheme;
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;
    }

    /** Non-empty host, and a port that's either omitted (standard port) or numeric. */
    public boolean isUsable() {
        return host != null && !host.trim().isEmpty()
                && (port == null || port.isEmpty() || port.matches("\\d+"));
    }

    public boolean hasCredentials() {
        return username != null && !username.isEmpty();
    }

    public String getBaseUrl() {
        String portSuffix = port != null && !port.isEmpty() ? ":" + port : "";
        return scheme + "://" + host + portSuffix;
    }

    /** host, or host:port when a non-standard port was entered -- for display only. */
    public String getHostDisplay() {
        return port != null && !port.isEmpty() ? host + ":" + port : host;
    }

    public String getStreamUrl() {
        return getBaseUrl() + "/stream";
    }

    public String getLabel() {
        return id == Id.INTERNAL ? "Internal" : "External";
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ServerProfile)) return false;
        ServerProfile other = (ServerProfile) o;
        return id == other.id
                && eq(scheme, other.scheme)
                && eq(host, other.host)
                && eq(port, other.port)
                && eq(username, other.username)
                && eq(password, other.password);
    }

    @Override
    public int hashCode() {
        int result = id.hashCode();
        result = 31 * result + hash(scheme);
        result = 31 * result + hash(host);
        result = 31 * result + hash(port);
        result = 31 * result + hash(username);
        result = 31 * result + hash(password);
        return result;
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    private static int hash(String s) {
        return s == null ? 0 : s.hashCode();
    }
}
