package com.radioclyde.tv.model;

import org.json.JSONObject;

public class UpcomingShow {
    public final String id;
    public final String name;
    public final String host; // nullable
    public final String weekday; // lowercase full day name, e.g. "monday"
    public final String startTime; // "HH:MM"

    private UpcomingShow(String id, String name, String host, String weekday, String startTime) {
        this.id = id;
        this.name = name;
        this.host = host;
        this.weekday = weekday;
        this.startTime = startTime;
    }

    public static UpcomingShow fromJson(JSONObject json) {
        if (json == null) return null;
        return new UpcomingShow(
                JsonUtil.optNullableString(json, "id"),
                JsonUtil.optNullableString(json, "name"),
                JsonUtil.optNullableString(json, "host"),
                JsonUtil.optNullableString(json, "weekday"),
                JsonUtil.optNullableString(json, "startTime"));
    }
}
