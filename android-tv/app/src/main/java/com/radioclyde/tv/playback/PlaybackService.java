package com.radioclyde.tv.playback;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.radioclyde.tv.R;
import com.radioclyde.tv.model.NowPlaying;
import com.radioclyde.tv.model.Track;
import com.radioclyde.tv.net.ApiClient;
import com.radioclyde.tv.settings.SettingsRepository;

import java.util.Locale;

/**
 * Foreground MediaSessionService hosting the single live ExoPlayer stream.
 * Keeps audio playing in the background and wires the TV remote's
 * transport keys / the lock-screen media controls to the same Player via
 * the platform's MediaSession routing -- no custom key handling needed.
 */
@UnstableApi
public class PlaybackService extends MediaSessionService {

    private static final String LIVE_MEDIA_ID = "live-stream";

    /**
     * MediaMetadata.extras key for the current show's name -- neither
     * title nor artist maps cleanly to "show name" (title/artist carry the
     * track or the "DJ talking" line), so it rides in extras instead of
     * overloading an existing field. Read via player.getMediaMetadata()
     * .extras on the client (see PlaybackActivity).
     */
    public static final String EXTRA_SHOW_NAME = "showName";

    /**
     * MediaMetadata.extras keys for the current track's progress -- epoch
     * millis the track started, and its total duration. The client ticks
     * elapsed/remaining locally from these every second (mirrors
     * public/app.js's tickTrackProgress) rather than polling every second.
     * Absent (or -1) when a DJ is talking instead of a track playing.
     */
    public static final String EXTRA_PLAYED_AT_EPOCH_MS = "playedAtEpochMs";

    public static final String EXTRA_DURATION_MS = "durationMs";

    private ExoPlayer player;
    private MediaSession mediaSession;
    private MetadataPoller metadataPoller;
    private SettingsRepository settings;

    @Override
    public void onCreate() {
        super.onCreate();
        settings = new SettingsRepository(this);

        AuthenticatedHttpDataSourceFactory dataSourceFactory = new AuthenticatedHttpDataSourceFactory(settings);
        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
                .build();

        // Always have a MediaItem present (without starting playback) so
        // MetadataPoller can replaceMediaItem() as soon as the first poll
        // lands, regardless of whether the user has pressed play yet.
        player.setMediaItem(buildLiveMediaItem());

        mediaSession = new MediaSession.Builder(this, player)
                .setBitmapLoader(new AuthArtBitmapLoader(settings))
                .setCallback(new RestrictSkipCallback())
                .build();

        // Runs for the service's whole lifetime, not gated on isPlaying --
        // the default screen (PlaybackActivity) shows now-playing info as
        // soon as it's open, before the user presses Play, so metadata
        // can't wait for actual playback to start.
        metadataPoller = new MetadataPoller(new ApiClient(settings), this::onNowPlaying);
        metadataPoller.start();
    }

    private MediaItem buildLiveMediaItem() {
        return new MediaItem.Builder()
                .setMediaId(LIVE_MEDIA_ID)
                .setUri(Uri.parse(settings.getStreamUrl()))
                .setMediaMetadata(new MediaMetadata.Builder()
                        .setTitle(getString(R.string.app_name))
                        .build())
                .build();
    }

    private void onNowPlaying(NowPlaying nowPlaying) {
        MediaItem current = player.getCurrentMediaItem();
        if (current == null) return;

        MediaMetadata.Builder metadata = new MediaMetadata.Builder();
        if (nowPlaying.dj != null) {
            metadata.setTitle(getString(R.string.dj_talking_format, nowPlaying.dj));
            if (nowPlaying.show != null && nowPlaying.show.name != null) {
                metadata.setArtist(nowPlaying.show.name);
            }
            // A handoff joins names with " & " (see server/showName.js);
            // only the first persona's photo is shown for that rare case.
            // Not every persona has a photo yet -- a missing one 404s and
            // both AuthArtBitmapLoader and PlaybackActivity's Glide.error()
            // already treat that as "nothing to show", no extra handling.
            String persona = nowPlaying.dj.split(" & ")[0].toLowerCase(Locale.US);
            metadata.setArtworkUri(Uri.parse(settings.getBaseUrl() + "/dj-photos/" + persona));
        } else if (nowPlaying.track != null) {
            Track track = nowPlaying.track;
            metadata.setTitle(track.title);
            metadata.setArtist(track.artist);
            metadata.setAlbumTitle(track.album);
            if (track.artUrl != null) {
                metadata.setArtworkUri(Uri.parse(settings.getBaseUrl() + track.artUrl));
            }
        }
        Bundle extras = new Bundle();
        if (nowPlaying.show != null && nowPlaying.show.name != null) {
            extras.putString(EXTRA_SHOW_NAME, nowPlaying.show.name);
        }
        if (nowPlaying.dj == null && nowPlaying.track != null && nowPlaying.track.durationMs != null) {
            long playedAtEpochMs = nowPlaying.track.playedAtEpochMs();
            if (playedAtEpochMs >= 0) {
                extras.putLong(EXTRA_PLAYED_AT_EPOCH_MS, playedAtEpochMs);
                extras.putLong(EXTRA_DURATION_MS, nowPlaying.track.durationMs);
            }
        }
        metadata.setExtras(extras);

        int index = player.getCurrentMediaItemIndex();
        MediaItem updated = current.buildUpon().setMediaMetadata(metadata.build()).build();
        player.replaceMediaItem(index, updated);
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // App swiped away from recents: keep the foreground service (and
        // audio) alive if actively playing, otherwise let it stop.
        if (player == null || !player.isPlaying()) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        if (metadataPoller != null) metadataPoller.shutdown();
        if (mediaSession != null) {
            mediaSession.getPlayer().release();
            mediaSession.release();
        }
        super.onDestroy();
    }

    /** No queue -- hides skip-next/previous from the system notification. */
    private static class RestrictSkipCallback implements MediaSession.Callback {
        @Override
        public MediaSession.ConnectionResult onConnect(MediaSession session, MediaSession.ControllerInfo controller) {
            MediaSession.ConnectionResult defaultResult = MediaSession.Callback.super.onConnect(session, controller);
            Player.Commands availableCommands = defaultResult.availablePlayerCommands.buildUpon()
                    .remove(Player.COMMAND_SEEK_TO_NEXT)
                    .remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                    .remove(Player.COMMAND_SEEK_TO_PREVIOUS)
                    .remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build();
            return new MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                    .setAvailablePlayerCommands(availableCommands)
                    .build();
        }
    }
}
