package com.radioclyde.mobile.playback;

import android.os.Handler;
import android.os.Looper;

import com.radioclyde.mobile.model.NowPlaying;
import com.radioclyde.mobile.net.ApiClient;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Polls /api/now-playing every 12s (matching public/app.js's cadence) while
 * playback is active, and only while active -- started/stopped by
 * PlaybackService in response to Player.Listener#onIsPlayingChanged, so
 * "now playing" metadata stays fresh in the system notification/lock screen
 * even with no app UI visible.
 */
public class MetadataPoller {

    public interface Listener {
        void onNowPlaying(NowPlaying nowPlaying);
    }

    private static final long INTERVAL_MS = 12000;

    private final ApiClient apiClient;
    private final Listener listener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService backgroundExecutor = Executors.newSingleThreadExecutor();
    private final Runnable tick = this::tick;

    private volatile boolean running = false;

    public MetadataPoller(ApiClient apiClient, Listener listener) {
        this.apiClient = apiClient;
        this.listener = listener;
    }

    public void start() {
        if (running) return;
        running = true;
        mainHandler.removeCallbacks(tick);
        mainHandler.post(tick); // immediate first poll, then every INTERVAL_MS
    }

    public void stop() {
        running = false;
        mainHandler.removeCallbacks(tick);
    }

    public void shutdown() {
        stop();
        backgroundExecutor.shutdown();
    }

    private void tick() {
        if (!running) return;
        backgroundExecutor.execute(() -> {
            NowPlaying result = null;
            try {
                result = apiClient.fetchNowPlaying();
            } catch (IOException e) {
                // transient network hiccup -- next poll will retry (mirrors app.js's catch{})
            }
            NowPlaying finalResult = result;
            mainHandler.post(() -> {
                if (!running) return;
                if (finalResult != null) listener.onNowPlaying(finalResult);
                mainHandler.postDelayed(tick, INTERVAL_MS);
            });
        });
    }
}
