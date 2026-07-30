package com.radioclyde.tv.net;

import com.radioclyde.tv.model.HistoryEntry;
import com.radioclyde.tv.model.NowPlaying;
import com.radioclyde.tv.model.UpcomingShow;
import com.radioclyde.tv.model.Weather;
import com.radioclyde.tv.settings.SettingsRepository;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Blocking client for the station server's GET endpoints. Every call
 * must run off the caller's main thread. Mirrors public/app.js's polling
 * behavior: callers are expected to catch IOException and just try again on
 * the next poll tick rather than surfacing a hard error.
 */
public class ApiClient {

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 8000;

    private final SettingsRepository settings;

    public ApiClient(SettingsRepository settings) {
        this.settings = settings;
    }

    public NowPlaying fetchNowPlaying() throws IOException {
        JSONObject json = getJsonObject("/api/now-playing");
        return NowPlaying.fromJson(json);
    }

    public List<HistoryEntry> fetchHistory(int limit) throws IOException {
        String path = "/api/history" + (limit > 0 ? "?limit=" + limit : "");
        JSONObject json = getJsonObject(path);
        JSONArray entries = json.optJSONArray("entries");
        List<HistoryEntry> result = new ArrayList<>();
        if (entries != null) {
            for (int i = 0; i < entries.length(); i++) {
                HistoryEntry entry = HistoryEntry.fromJson(entries.optJSONObject(i));
                if (entry != null) result.add(entry);
            }
        }
        return result;
    }

    public List<UpcomingShow> fetchUpcoming() throws IOException {
        JSONObject json = getJsonObject("/api/upcoming");
        JSONArray shows = json.optJSONArray("shows");
        List<UpcomingShow> result = new ArrayList<>();
        if (shows != null) {
            for (int i = 0; i < shows.length(); i++) {
                UpcomingShow show = UpcomingShow.fromJson(shows.optJSONObject(i));
                if (show != null) result.add(show);
            }
        }
        return result;
    }

    public Weather fetchWeather() throws IOException {
        JSONObject json = getJsonObject("/api/weather");
        return Weather.fromJson(json);
    }

    private JSONObject getJsonObject(String path) throws IOException {
        HttpURLConnection connection = openConnection(path);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException(path + " returned HTTP " + status);
            }
            String body = readBody(connection.getInputStream());
            return (JSONObject) new JSONTokener(body).nextValue();
        } catch (JSONException e) {
            throw new IOException("Malformed JSON from " + path, e);
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection openConnection(String path) throws IOException {
        URL url = new URL(settings.getBaseUrl() + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Authorization",
                AuthHeader.buildBasicAuthValue(settings.getUsername(), settings.getPassword()));
        return connection;
    }

    private static String readBody(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int read;
        while ((read = in.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toString(StandardCharsets.UTF_8.name());
    }
}
