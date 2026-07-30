package com.radioclyde.tv.model;

import org.json.JSONObject;

/**
 * org.json's optString(key, fallback) only returns the fallback when the
 * key is absent -- when the key is present with an explicit JSON null
 * (which every nullable field in this API can legitimately send, e.g. "dj"
 * when a track is playing), it returns the literal string "null" instead,
 * since JSONObject.NULL.toString() == "null". That silently turns "no DJ
 * talking" into a truthy non-null string. This is the one safe way to read
 * a nullable string field.
 */
final class JsonUtil {

    private JsonUtil() {}

    static String optNullableString(JSONObject json, String key) {
        return (json.has(key) && !json.isNull(key)) ? json.optString(key) : null;
    }
}
