package com.radioclyde.mobile.ui;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.Toolbar;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;
import com.google.android.material.button.MaterialButton;
import com.google.common.util.concurrent.ListenableFuture;
import com.radioclyde.mobile.R;
import com.radioclyde.mobile.RadioMobileApplication;
import com.radioclyde.mobile.model.HistoryEntry;
import com.radioclyde.mobile.model.NowPlaying;
import com.radioclyde.mobile.model.Show;
import com.radioclyde.mobile.model.Station;
import com.radioclyde.mobile.net.ActiveProfileResolver;
import com.radioclyde.mobile.net.ApiClient;
import com.radioclyde.mobile.net.GlideAuthHeaderFactory;
import com.radioclyde.mobile.playback.PlaybackService;
import com.radioclyde.mobile.settings.ProfileRepository;
import com.radioclyde.mobile.settings.ServerProfile;
import com.radioclyde.mobile.settings.SettingsActivity;
import com.radioclyde.mobile.util.AppExecutors;

import java.io.IOException;
import java.util.List;
import java.util.Locale;

/**
 * The app's launcher screen: station branding + show name, an "On Air"
 * now-playing card, a Play/Pause button, and a Recently Played list. Tracks
 * now-playing/history purely from server polling, independent of whether
 * the stream is actually playing -- opening the app shows what's on air
 * without starting audio. No clock, no weather (see android-tv's version
 * for those -- deliberately dropped here).
 */
public class PlaybackActivity extends AppCompatActivity implements ActiveProfileResolver.Listener {

    private static final long POLL_INTERVAL_MS = 12000;
    private static final long TICK_INTERVAL_MS = 1000;
    private static final int HISTORY_LIMIT = 8;

    private ProfileRepository profileRepository;
    private ActiveProfileResolver resolver;
    private ApiClient apiClient;
    private HistoryAdapter historyAdapter;

    private TextView showNameView;
    private ImageView stationLogoView;
    private ImageView trackArtView;
    private TextView trackTitleView;
    private TextView trackArtistView;
    private View progressContainer;
    private ProgressBar progressBar;
    private TextView elapsedView;
    private TextView durationView;
    private MaterialButton playPauseButton;

    private ListenableFuture<MediaController> controllerFuture;
    private MediaController controller;

    // Set from the current MediaMetadata's extras and ticked client-side
    // every second so the progress bar moves smoothly between polls.
    private volatile long playedAtEpochMs = -1;
    private volatile long trackDurationMs = -1;

    // The live station name from /api/now-playing's "station" object (e.g.
    // "Radio Iona", from station.json) -- R.string.app_name is only the
    // launcher label baked in at build time and is used as a fallback here
    // until the first poll lands, not as the source of truth.
    private String stationName;

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
        // Only meaningful while this screen is in the foreground -- the
        // system screensaver/lock behaves normally again once backgrounded
        // (e.g. to keep playing while the phone is put away).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        RadioMobileApplication app = (RadioMobileApplication) getApplication();
        profileRepository = app.getProfileRepository();
        resolver = app.getActiveProfileResolver();
        apiClient = new ApiClient(resolver);

        setSupportActionBar((Toolbar) findViewById(R.id.toolbar));

        showNameView = findViewById(R.id.show_name);
        stationLogoView = findViewById(R.id.station_logo);
        trackArtView = findViewById(R.id.track_art);
        trackTitleView = findViewById(R.id.track_title);
        trackArtistView = findViewById(R.id.track_artist);
        progressContainer = findViewById(R.id.track_progress_container);
        progressBar = findViewById(R.id.track_progress_bar);
        elapsedView = findViewById(R.id.track_elapsed);
        durationView = findViewById(R.id.track_duration);
        playPauseButton = findViewById(R.id.play_pause_button);

        historyAdapter = new HistoryAdapter(resolver);
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
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.menu_playback, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.action_settings) {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    protected void onStart() {
        super.onStart();

        if (!profileRepository.hasAnyUsableProfile()) {
            startActivity(new Intent(this, SettingsActivity.class));
            return;
        }

        resolver.addListener(this);
        resolver.requestProbe(false);

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
        resolver.removeListener(this);
        mainHandler.removeCallbacks(pollRunnable);
        mainHandler.removeCallbacks(tickRunnable);

        // Releases the controller only -- playback itself is an explicit
        // user action (Play/Pause), not tied to this Activity's lifecycle.
        if (controller != null) {
            controller.removeListener(playerListener);
            controller = null;
        }
        if (controllerFuture != null) {
            MediaController.releaseFuture(controllerFuture);
        }
    }

    /** Skip the remaining wait on the current 12s poll window when the active server changes. */
    @Override
    public void onActiveProfileChanged(ServerProfile profile) {
        mainHandler.removeCallbacks(pollRunnable);
        mainHandler.post(pollRunnable);
    }

    private void applyMetadata(MediaMetadata metadata) {
        String showName = metadata.extras != null ? metadata.extras.getString(PlaybackService.EXTRA_SHOW_NAME) : null;
        showNameView.setText(showName != null ? showName : getString(R.string.app_name));

        trackTitleView.setText(metadata.title != null ? metadata.title : getString(R.string.app_name));
        trackArtistView.setText(metadata.artist);
        trackArtistView.setVisibility(metadata.artist != null ? View.VISIBLE : View.GONE);

        if (metadata.artworkUri != null) {
            loadRelativeArt(metadata.artworkUri.toString(), trackArtView);
        } else {
            trackArtView.setImageResource(R.drawable.card_placeholder);
        }

        playedAtEpochMs = metadata.extras != null ? metadata.extras.getLong(PlaybackService.EXTRA_PLAYED_AT_EPOCH_MS, -1) : -1;
        trackDurationMs = metadata.extras != null ? metadata.extras.getLong(PlaybackService.EXTRA_DURATION_MS, -1) : -1;
        updateProgressDisplay();
    }

    /** Resolves against whatever profile is active *now* -- see AuthArtBitmapLoader's class doc for why this can't be baked in earlier. */
    private void loadRelativeArt(String relativePath, ImageView into) {
        ServerProfile profile = resolver.getActiveProfile();
        if (profile == null) {
            into.setImageResource(R.drawable.card_placeholder);
            return;
        }
        try {
            Glide.with(this)
                    .load(GlideAuthHeaderFactory.buildGlideUrl(profile.getBaseUrl() + relativePath, profile))
                    .placeholder(R.drawable.card_placeholder)
                    .error(R.drawable.card_placeholder)
                    .into(into);
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
        loadRelativeArt(path, stationLogoView);
    }

    /** The toolbar title -- the actual live station name, e.g. "Radio Iona" from station.json, not the build-time app label. */
    private void applyStationName(Station station) {
        stationName = station != null && station.name != null ? station.name : getString(R.string.app_name);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle(stationName);
        }
    }

    private void applyShowName(Show show) {
        String fallback = stationName != null ? stationName : getString(R.string.app_name);
        showNameView.setText(show != null && show.name != null ? show.name : fallback);
    }

    private void updatePlayPauseIcon(boolean isPlaying) {
        playPauseButton.setIconResource(isPlaying ? R.drawable.ic_pause : R.drawable.ic_play);
        playPauseButton.setText(isPlaying ? R.string.action_pause : R.string.action_play);
    }

    private void poll() {
        AppExecutors.runOnBackground(() -> {
            try {
                // Fetched together (not derived from the service's
                // independently-polled MediaMetadata) so "is a track
                // currently playing" can't race against it.
                NowPlaying nowPlaying = apiClient.fetchNowPlaying();
                List<HistoryEntry> entries = apiClient.fetchHistory(HISTORY_LIMIT);
                // The currently-playing track is also entries.get(0) -- skip
                // it, since it's already shown in the now-playing card above.
                boolean trackIsPlaying = nowPlaying.dj == null && nowPlaying.track != null;
                List<HistoryEntry> displayEntries =
                        trackIsPlaying && !entries.isEmpty() ? entries.subList(1, entries.size()) : entries;
                runOnUiThread(() -> {
                    if (!isFinishing() && !isDestroyed()) {
                        historyAdapter.submit(displayEntries);
                        applyStationName(nowPlaying.station);
                        applyStationLogo(nowPlaying.show);
                        applyShowName(nowPlaying.show);
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
}
