package com.radioclyde.tv.model;

import org.json.JSONObject;

/**
 * Exactly one of {@link #track}/{@link #dj} is meaningful at a time: when
 * {@code dj} is set, a DJ is talking and there is no currently-airing track.
 */
public class NowPlaying {
    public final Station station;
    public final Show show; // nullable
    public final Track track; // nullable
    public final String dj; // nullable, capitalized persona name(s)
    public final String scheduledStart; // nullable, "HH:MM"
    public final String estimatedEndAt; // nullable, ISO string

    private NowPlaying(Station station, Show show, Track track, String dj, String scheduledStart, String estimatedEndAt) {
        this.station = station;
        this.show = show;
        this.track = track;
        this.dj = dj;
        this.scheduledStart = scheduledStart;
        this.estimatedEndAt = estimatedEndAt;
    }

    public static NowPlaying fromJson(JSONObject json) {
        return new NowPlaying(
                Station.fromJson(json.optJSONObject("station")),
                Show.fromJson(json.optJSONObject("show")),
                Track.fromJson(json.optJSONObject("track")),
                JsonUtil.optNullableString(json, "dj"),
                JsonUtil.optNullableString(json, "scheduledStart"),
                JsonUtil.optNullableString(json, "estimatedEndAt"));
    }
}
