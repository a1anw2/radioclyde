package com.radioclyde.tv.ui;

import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;
import com.google.common.util.concurrent.ListenableFuture;
import com.radioclyde.tv.R;
import com.radioclyde.tv.model.HistoryEntry;
import com.radioclyde.tv.model.NowPlaying;
import com.radioclyde.tv.model.Show;
import com.radioclyde.tv.model.Weather;
import com.radioclyde.tv.net.ApiClient;
import com.radioclyde.tv.net.GlideAuthHeaderFactory;
import com.radioclyde.tv.playback.PlaybackService;
import com.radioclyde.tv.settings.SettingsActivity;
import com.radioclyde.tv.settings.SettingsRepository;
import com.radioclyde.tv.util.AppExecutors;

import java.io.IOException;
import java.util.List;
import java.util.Locale;

/**
 * The app's default (launcher) screen: station branding + show name + clock
 * + weather + transport controls on the left, current track + recently-
 * played list on the right. Tracks now-playing/history/weather purely from
 * server polling, independent of whether the stream is actually playing --
 * opening the app shows what's on air without starting audio; the user
 * explicitly presses Play.
 */
public class PlaybackActivity extends FragmentActivity {

    private static final long POLL_INTERVAL_MS = 12000;
    private static final long TICK_INTERVAL_MS = 1000;
    private static final int HISTORY_LIMIT = 8;

    private SettingsRepository settings;
    private ApiClient apiClient;
    private HistoryAdapter historyAdapter;

    private TextView showNameView;
    private TextView weatherTempView;
    private ImageView stationLogoView;
    private ImageView trackArtView;
    private TextView trackTitleView;
    private TextView trackArtistView;
    private View progressContainer;
    private ProgressBar progressBar;
    private TextView elapsedView;
    private TextView durationView;
    private ImageButton playPauseButton;

    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;

    // Set from the current MediaMetadata's extras and ticked client-side
    // every second so the progress bar moves smoothly between polls --
    // mirrors public/app.js's currentTrackTiming/tickTrackProgress.
    private volatile long playedAtEpochMs = -1;
    private volatile long trackDurationMs = -1;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable pollRunnable = this::poll;
    private final Runnable tickRunnable = this::tickProgress;

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onMediaMetadataChanged(MediaMetadata mediaMetadata) {
            applyMetadata(mediaMetadata);
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            updatePlayPauseIcon(isPlaying);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_playback);
        // Only meaningful while this screen is actually in the foreground --
        // the flag is tied to this window, so the screensaver behaves
        // normally again as soon as the user backs out (e.g. to keep
        // playing in the background), which is the desired scope.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        settings = new SettingsRepository(this);
        apiClient = new ApiClient(settings);

        showNameView = findViewById(R.id.show_name);
        weatherTempView = findViewById(R.id.weather_temp);
        stationLogoView = findViewById(R.id.station_logo);
        trackArtView = findViewById(R.id.track_art);
        trackTitleView = findViewById(R.id.track_title);
        trackArtistView = findViewById(R.id.track_artist);
        progressContainer = findViewById(R.id.track_progress_container);
        progressBar = findViewById(R.id.track_progress_bar);
        elapsedView = findViewById(R.id.track_elapsed);
        durationView = findViewById(R.id.track_duration);
        playPauseButton = findViewById(R.id.play_pause_button);
        ImageButton exitButton = findViewById(R.id.exit_button);
        ImageButton settingsButton = findViewById(R.id.settings_button);

        historyAdapter = new HistoryAdapter(settings);
        RecyclerView historyList = findViewById(R.id.history_list);
        historyList.setLayoutManager(new LinearLayoutManager(this));
        historyList.setAdapter(historyAdapter);

        playPauseButton.setOnClickListener(v -> {
            if (controller == null) return;
            if (controller.isPlaying()) {
                controller.pause();
            } else {
                if (controller.getPlaybackState() == Player.STATE_IDLE) {
                    controller.prepare();
                }
                controller.play();
            }
        });
        exitButton.setOnClickListener(v -> {
            if (controller != null) controller.stop();
            finish();
        });
        settingsButton.setOnClickListener(v -> startActivity(new Intent(this, SettingsActivity.class)));
    }

    @Override
    protected void onStart() {
        super.onStart();

        if (!settings.isConfigured()) {
            startActivity(new Intent(this, SettingsActivity.class));
            return;
        }

        SessionToken token = new SessionToken(this, new ComponentName(this, PlaybackService.class));
        controllerFuture = new MediaController.Builder(this, token).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                controller = controllerFuture.get();
            } catch (Exception e) {
                return; // connection failed -- nothing to bind
            }
            controller.addListener(playerListener);
            applyMetadata(controller.getMediaMetadata());
            updatePlayPauseIcon(controller.isPlaying());
        }, ContextCompat.getMainExecutor(this));

        mainHandler.removeCallbacks(pollRunnable);
        mainHandler.post(pollRunnable);
        mainHandler.removeCallbacks(tickRunnable);
        mainHandler.post(tickRunnable);
    }

    @Override
    protected void onStop() {
        super.onStop();
        mainHandler.removeCallbacks(pollRunnable);
        mainHandler.removeCallbacks(tickRunnable);

        // Releases the controller only -- playback itself is an explicit
        // user action (Play/Pause or Exit), not tied to this Activity's
        // lifecycle, so backgrounding this screen doesn't stop the stream.
        if (controller != null) {
            controller.removeListener(playerListener);
            controller = null;
        }
        if (controllerFuture != null) {
            MediaController.releaseFuture(controllerFuture);
        }
    }

    private void applyMetadata(MediaMetadata metadata) {
        String showName = metadata.extras != null ? metadata.extras.getString(PlaybackService.EXTRA_SHOW_NAME) : null;
        showNameView.setText(showName != null ? showName : getString(R.string.app_name));

        trackTitleView.setText(metadata.title != null ? metadata.title : getString(R.string.app_name));
        trackArtistView.setText(metadata.artist);
        trackArtistView.setVisibility(metadata.artist != null ? View.VISIBLE : View.GONE);

        if (metadata.artworkUri != null) {
            loadArt(metadata.artworkUri);
        } else {
            trackArtView.setImageResource(R.drawable.card_placeholder);
        }

        playedAtEpochMs = metadata.extras != null ? metadata.extras.getLong(PlaybackService.EXTRA_PLAYED_AT_EPOCH_MS, -1) : -1;
        trackDurationMs = metadata.extras != null ? metadata.extras.getLong(PlaybackService.EXTRA_DURATION_MS, -1) : -1;
        updateProgressDisplay();
    }

    private void loadArt(Uri artworkUri) {
        try {
            Glide.with(this)
                    .load(GlideAuthHeaderFactory.buildGlideUrl(artworkUri.toString(), settings))
                    .placeholder(R.drawable.card_placeholder)
                    .error(R.drawable.card_placeholder)
                    .into(trackArtView);
        } catch (IllegalArgumentException e) {
            // Activity already destroyed -- nothing to bind.
        }
    }

    /**
     * /api/show-logo/:showId falls back to the station logo server-side
     * when a show doesn't have its own yet, so the only client-side
     * fallback needed is for when no show is airing at all (e.g. downtime).
     */
    private void applyStationLogo(Show show) {
        String path = show != null && show.id != null ? "/api/show-logo/" + show.id : "/logo.png";
        String url = settings.getBaseUrl() + path;
        try {
            Glide.with(this)
                    .load(GlideAuthHeaderFactory.buildGlideUrl(url, settings))
                    .placeholder(R.drawable.card_placeholder)
                    .error(R.drawable.card_placeholder)
                    .into(stationLogoView);
        } catch (IllegalArgumentException e) {
            // Activity already destroyed -- nothing to bind.
        }
    }

    private void updatePlayPauseIcon(boolean isPlaying) {
        playPauseButton.setImageResource(isPlaying ? R.drawable.ic_pause : R.drawable.ic_play);
    }

    private void poll() {
        AppExecutors.runOnBackground(() -> {
            try {
                // Fetched together (not derived from the service's
                // independently-polled MediaMetadata) so the "is a track
                // currently playing" check below can't race against it --
                // same reasoning as MainBrowseFragment's combined poll.
                NowPlaying nowPlaying = apiClient.fetchNowPlaying();
                List<HistoryEntry> entries = apiClient.fetchHistory(HISTORY_LIMIT);
                // The currently-playing track is also entries.get(0) -- skip
                // it, since it's already shown in the now-playing card above.
                boolean trackIsPlaying = nowPlaying.dj == null && nowPlaying.track != null;
                List<HistoryEntry> displayEntries =
                        trackIsPlaying && !entries.isEmpty() ? entries.subList(1, entries.size()) : entries;
                AppExecutors.runOnMain(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        historyAdapter.submit(displayEntries);
                        applyStationLogo(nowPlaying.show);
                    }
                });
            } catch (IOException e) {
                // transient network hiccup -- next poll will retry
            }

            try {
                Weather weather = apiClient.fetchWeather();
                AppExecutors.runOnMain(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        applyWeather(weather);
                    }
                });
            } catch (IOException e) {
                // transient network hiccup -- next poll will retry
            }
        });
        mainHandler.postDelayed(pollRunnable, POLL_INTERVAL_MS);
    }

    /** Self-perpetuating 1s loop -- only ever invoked via tickRunnable, never called directly. */
    private void tickProgress() {
        updateProgressDisplay();
        mainHandler.postDelayed(tickRunnable, TICK_INTERVAL_MS);
    }

    private void updateProgressDisplay() {
        if (playedAtEpochMs < 0 || trackDurationMs <= 0) {
            progressContainer.setVisibility(View.GONE);
            return;
        }
        long elapsedMs = Math.max(0, Math.min(System.currentTimeMillis() - playedAtEpochMs, trackDurationMs));
        progressContainer.setVisibility(View.VISIBLE);
        progressBar.setProgress((int) (elapsedMs * 1000 / trackDurationMs));
        elapsedView.setText(formatClock(elapsedMs));
        durationView.setText(formatClock(trackDurationMs));
    }

    private static String formatClock(long ms) {
        long totalSeconds = Math.max(0, ms / 1000);
        long minutes = totalSeconds / 60;
        long seconds = totalSeconds % 60;
        return String.format(Locale.US, "%d:%02d", minutes, seconds);
    }

    private void applyWeather(Weather weather) {
        if (weather.temperatureF == null || weather.temperatureC == null) {
            weatherTempView.setVisibility(View.GONE);
            return;
        }
        weatherTempView.setText(getString(R.string.weather_temp_format, weather.temperatureF, weather.temperatureC));
        weatherTempView.setVisibility(View.VISIBLE);
    }
}
