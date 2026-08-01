package com.radioclyde.mobile.model;

import org.json.JSONObject;

public class HistoryEntry {
    public final String artist;
    public final String title;
    public final String artUrl; // nullable

    private HistoryEntry(String artist, String title, String artUrl) {
        this.artist = artist;
        this.title = title;
        this.artUrl = artUrl;
    }

    public static HistoryEntry fromJson(JSONObject json) {
        if (json == null) return null;
        return new HistoryEntry(
                JsonUtil.optNullableString(json, "artist"),
                JsonUtil.optNullableString(json, "title"),
                JsonUtil.optNullableString(json, "artUrl"));
    }
}
