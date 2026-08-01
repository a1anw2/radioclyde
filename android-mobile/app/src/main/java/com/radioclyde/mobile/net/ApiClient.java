package com.radioclyde.mobile.net;

import com.radioclyde.mobile.model.HistoryEntry;
import com.radioclyde.mobile.model.NowPlaying;
import com.radioclyde.mobile.settings.ServerProfile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * Blocking client for the station server's GET endpoints. Every call must
 * run off the caller's main thread. Mirrors android-tv's ApiClient, except
 * it resolves the base URL fresh from ActiveProfileResolver on every call
 * (instead of a single fixed SettingsRepository) and feeds the resolver
 * success/failure, since every poller in this app goes through here.
 */
public class ApiClient {

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 8000;

    private final ActiveProfileResolver resolver;

    public ApiClient(ActiveProfileResolver resolver) {
        this.resolver = resolver;
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

    private JSONObject getJsonObject(String path) throws IOException {
        ServerProfile profile = resolver.getActiveProfile();
        if (profile == null) {
            resolver.reportFailure();
            throw new IOException("No reachable server profile");
        }

        HttpURLConnection connection = openConnection(profile, path);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException(path + " returned HTTP " + status);
            }
            String body = HttpUtil.readBody(connection.getInputStream());
            JSONObject result = (JSONObject) new JSONTokener(body).nextValue();
            resolver.reportSuccess();
            return result;
        } catch (JSONException e) {
            resolver.reportFailure();
            throw new IOException("Malformed JSON from " + path, e);
        } catch (IOException e) {
            resolver.reportFailure();
            throw e;
        } finally {
            connection.disconnect();
        }
    }

    private static HttpURLConnection openConnection(ServerProfile profile, String path) throws IOException {
        URL url = new URL(profile.getBaseUrl() + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        if (profile.hasCredentials()) {
            connection.setRequestProperty("Authorization",
                    AuthHeader.buildBasicAuthValue(profile.username, profile.password));
        }
        return connection;
    }
}
