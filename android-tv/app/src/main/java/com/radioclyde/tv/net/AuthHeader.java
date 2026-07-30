package com.radioclyde.tv.net;

import android.util.Base64;

import java.nio.charset.StandardCharsets;

/**
 * Single shared implementation of the station server's Basic auth header,
 * used by every client of that server (JSON API, album art, and the
 * ExoPlayer HTTP data source for /stream) -- the server's auth hook accepts
 * this header unconditionally and ignores it harmlessly on trusted-network
 * requests, so callers never need to special-case network detection.
 */
public final class AuthHeader {

    private AuthHeader() {}

    public static String buildBasicAuthValue(String username, String password) {
        String credentials = username + ":" + password;
        String encoded = Base64.encodeToString(credentials.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        return "Basic " + encoded;
    }
}
