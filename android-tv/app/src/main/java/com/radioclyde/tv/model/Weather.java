package com.radioclyde.tv.model;

import org.json.JSONObject;

public class Weather {
    public final Integer temperatureF; // nullable
    public final Integer temperatureC; // nullable
    public final String condition; // nullable

    private Weather(Integer temperatureF, Integer temperatureC, String condition) {
        this.temperatureF = temperatureF;
        this.temperatureC = temperatureC;
        this.condition = condition;
    }

    public static Weather fromJson(JSONObject json) {
        Integer f = json.has("temperatureF") && !json.isNull("temperatureF") ? json.optInt("temperatureF") : null;
        Integer c = json.has("temperatureC") && !json.isNull("temperatureC") ? json.optInt("temperatureC") : null;
        return new Weather(f, c, JsonUtil.optNullableString(json, "condition"));
    }
}
