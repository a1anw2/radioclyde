package com.radioclyde.mobile.model;

import org.json.JSONObject;

import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

public class Track {
    public final String artist;
    public final String title;
    public final String album;
    public final String artUrl; // nullable, relative path e.g. "/api/art/123"
    public final Long durationMs; // nullable
    public final String playedAt; // nullable, raw ISO-8601 string

    private Track(String artist, String title, String album, String artUrl, Long durationMs, String playedAt) {
        this.artist = artist;
        this.title = title;
        this.album = album;
        this.artUrl = artUrl;
        this.durationMs = durationMs;
        this.playedAt = playedAt;
    }

    public static Track fromJson(JSONObject json) {
        if (json == null) return null;
        Long durationMs = json.has("durationMs") && !json.isNull("durationMs")
                ? json.optLong("durationMs")
                : null;
        return new Track(
                JsonUtil.optNullableString(json, "artist"),
                JsonUtil.optNullableString(json, "title"),
                JsonUtil.optNullableString(json, "album"),
                JsonUtil.optNullableString(json, "artUrl"),
                durationMs,
                JsonUtil.optNullableString(json, "playedAt"));
    }

    /** Epoch millis parsed from {@link #playedAt}, or -1 if absent/unparsable. */
    public long playedAtEpochMs() {
        if (playedAt == null) return -1;
        try {
            // The server sends a numeric zone offset (e.g. "-04:00"), not a
            // literal "Z" -- Instant.parse() only accepts "Z" and throws on
            // this format; OffsetDateTime.parse() handles both.
            return OffsetDateTime.parse(playedAt).toInstant().toEpochMilli();
        } catch (DateTimeParseException e) {
            return -1;
        }
    }
}
