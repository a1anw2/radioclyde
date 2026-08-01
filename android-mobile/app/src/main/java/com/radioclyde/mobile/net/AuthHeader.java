package com.radioclyde.mobile.net;

import android.util.Base64;

import java.nio.charset.StandardCharsets;

/**
 * Single shared implementation of the station server's Basic auth header.
 * The server's auth hook accepts this unconditionally and ignores it
 * harmlessly on trusted-network requests, so callers never need to
 * special-case network detection -- it's always safe to send, and safe to
 * send an empty username/password for the Internal profile (the server
 * never checks it when the request is already trusted by IP).
 */
public final class AuthHeader {

    private AuthHeader() {}

    public static String buildBasicAuthValue(String username, String password) {
        String credentials = username + ":" + password;
        String encoded = Base64.encodeToString(credentials.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        return "Basic " + encoded;
    }
}
