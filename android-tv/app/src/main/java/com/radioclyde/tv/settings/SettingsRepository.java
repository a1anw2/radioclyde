package com.radioclyde.tv.settings;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Wraps the only source of server configuration: host/port + Basic auth
 * username/password, entered by the user via the in-app guided-step
 * settings screen. No hardcoded fallback host -- an unconfigured app routes
 * straight to Settings (see PlaybackActivity).
 */
public class SettingsRepository {

    private static final String PREFS_NAME = "radio_prefs";
    private static final String KEY_HOST = "host";
    private static final String KEY_PORT = "port";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_PASSWORD = "password";

    public static final String DEFAULT_PORT_HINT = "8000";

    private final SharedPreferences prefs;

    public SettingsRepository(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public String getHost() {
        return prefs.getString(KEY_HOST, "");
    }

    public String getPort() {
        return prefs.getString(KEY_PORT, "");
    }

    public String getUsername() {
        return prefs.getString(KEY_USERNAME, "");
    }

    public String getPassword() {
        return prefs.getString(KEY_PASSWORD, "");
    }

    public void saveServerConfig(String host, String port) {
        prefs.edit().putString(KEY_HOST, host).putString(KEY_PORT, port).apply();
    }

    public void saveCredentials(String username, String password) {
        prefs.edit().putString(KEY_USERNAME, username).putString(KEY_PASSWORD, password).apply();
    }

    public boolean isConfigured() {
        return !getHost().isEmpty() && !getUsername().isEmpty();
    }

    public String getBaseUrl() {
        return "http://" + getHost() + ":" + getPort();
    }

    public String getStreamUrl() {
        return getBaseUrl() + "/stream";
    }
}
