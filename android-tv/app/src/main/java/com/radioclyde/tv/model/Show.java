package com.radioclyde.tv.model;

import org.json.JSONObject;

public class Show {
    public final String id;
    public final String name;
    public final String host; // nullable

    private Show(String id, String name, String host) {
        this.id = id;
        this.name = name;
        this.host = host;
    }

    public static Show fromJson(JSONObject json) {
        if (json == null) return null;
        return new Show(
                JsonUtil.optNullableString(json, "id"),
                JsonUtil.optNullableString(json, "name"),
                JsonUtil.optNullableString(json, "host"));
    }
}
