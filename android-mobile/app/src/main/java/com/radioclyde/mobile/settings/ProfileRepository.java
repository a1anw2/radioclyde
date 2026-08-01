package com.radioclyde.mobile.settings;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Wraps the two server profiles a listener can configure: Internal
 * (host/port only) and External (host/port + credentials). See
 * ServerProfile for why these are separate rather than one flat config --
 * ActiveProfileResolver decides at runtime which one is actually reachable.
 */
public class ProfileRepository {

    private static final String PREFS_NAME = "radio_prefs";

    private static final String KEY_INTERNAL_SCHEME = "internal_scheme";
    private static final String KEY_INTERNAL_HOST = "internal_host";
    private static final String KEY_INTERNAL_PORT = "internal_port";

    private static final String KEY_EXTERNAL_SCHEME = "external_scheme";
    private static final String KEY_EXTERNAL_HOST = "external_host";
    private static final String KEY_EXTERNAL_USERNAME = "external_username";
    private static final String KEY_EXTERNAL_PASSWORD = "external_password";

    public static final String DEFAULT_PORT_HINT = "8000";

    private final SharedPreferences prefs;

    public ProfileRepository(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public ServerProfile getInternal() {
        return new ServerProfile(
                ServerProfile.Id.INTERNAL,
                prefs.getString(KEY_INTERNAL_SCHEME, "http"),
                prefs.getString(KEY_INTERNAL_HOST, ""),
                prefs.getString(KEY_INTERNAL_PORT, ""),
                "",
                "");
    }

    public ServerProfile getExternal() {
        return new ServerProfile(
                ServerProfile.Id.EXTERNAL,
                prefs.getString(KEY_EXTERNAL_SCHEME, "https"),
                prefs.getString(KEY_EXTERNAL_HOST, ""),
                "", // External never has a port -- always the scheme's standard port
                prefs.getString(KEY_EXTERNAL_USERNAME, ""),
                prefs.getString(KEY_EXTERNAL_PASSWORD, ""));
    }

    public void saveInternal(String scheme, String host, String port) {
        prefs.edit()
                .putString(KEY_INTERNAL_SCHEME, scheme)
                .putString(KEY_INTERNAL_HOST, host)
                .putString(KEY_INTERNAL_PORT, port)
                .apply();
    }

    public void saveExternal(String scheme, String host, String username, String password) {
        prefs.edit()
                .putString(KEY_EXTERNAL_SCHEME, scheme)
                .putString(KEY_EXTERNAL_HOST, host)
                .putString(KEY_EXTERNAL_USERNAME, username)
                .putString(KEY_EXTERNAL_PASSWORD, password)
                .apply();
    }

    public boolean hasAnyUsableProfile() {
        return getInternal().isUsable() || getExternal().isUsable();
    }
}
