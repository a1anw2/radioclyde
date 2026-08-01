package com.radioclyde.mobile.model;

import org.json.JSONObject;

public class Station {
    public final String name; // nullable
    public final String streamUrl; // display-only, never used as the actual playback URI

    private Station(String name, String streamUrl) {
        this.name = name;
        this.streamUrl = streamUrl;
    }

    public static Station fromJson(JSONObject json) {
        if (json == null) return new Station(null, null);
        return new Station(JsonUtil.optNullableString(json, "name"), JsonUtil.optNullableString(json, "streamUrl"));
    }
}
