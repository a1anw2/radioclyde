package com.radioclyde.mobile.playback;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import com.radioclyde.mobile.R;
import com.radioclyde.mobile.RadioMobileApplication;
import com.radioclyde.mobile.model.NowPlaying;
import com.radioclyde.mobile.model.Track;
import com.radioclyde.mobile.net.ActiveProfileResolver;
import com.radioclyde.mobile.net.ApiClient;
import com.radioclyde.mobile.settings.ServerProfile;
import com.radioclyde.mobile.ui.PlaybackActivity;

import java.util.Locale;

/**
 * Foreground MediaSessionService hosting the single live ExoPlayer stream.
 * Keeps audio playing in the background and wires the platform's normal
 * MediaSession routing (lock-screen controls, headset buttons) to the same
 * Player -- no custom key handling needed.
 *
 * Unlike android-tv's PlaybackService (one fixed server), this one reacts to
 * ActiveProfileResolver switching between Internal/External: when the
 * resolved profile's stream URL changes, the live MediaItem is rebuilt so
 * ExoPlayer reconnects at the new host. See rebuildMediaItemForProfile().
 */
@UnstableApi
public class PlaybackService extends MediaSessionService implements ActiveProfileResolver.Listener {

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
     * elapsed/remaining locally from these every second rather than polling
     * every second. Absent (or -1) when a DJ is talking instead of a track.
     */
    public static final String EXTRA_PLAYED_AT_EPOCH_MS = "playedAtEpochMs";

    public static final String EXTRA_DURATION_MS = "durationMs";

    private ExoPlayer player;
    private MediaSession mediaSession;
    private MetadataPoller metadataPoller;
    private ActiveProfileResolver resolver;

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            if (isPlaying) {
                resolver.reportSuccess();
                return;
            }
            // STATE_READY + not playing == a real user/UI pause (as opposed
            // to buffering, natural end, or an error, which land in other
            // states). This is a live stream, not on-demand media: ExoPlayer
            // pausing normally just stops advancing playback while it keeps
            // buffering ahead in the background, so resuming later replays
            // that stale buffered audio instead of rejoining live. stop()
            // discards it; the next Play (from any surface -- in-app button,
            // notification, lock screen, Bluetooth controls) re-prepares,
            // which opens a fresh connection and naturally rejoins live
            // since Icecast has no seek/rewind.
            if (player.getPlaybackState() == Player.STATE_READY) {
                player.stop();
            }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            // A broken live connection is a strong enough signal to reprobe
            // immediately -- unlike a single dropped JSON poll, no need to
            // wait for a repeat (see ActiveProfileResolver.reportFailure()).
            resolver.reportFailure();
            resolver.requestProbe(true);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        resolver = ((RadioMobileApplication) getApplication()).getActiveProfileResolver();

        AuthenticatedHttpDataSourceFactory dataSourceFactory = new AuthenticatedHttpDataSourceFactory(resolver);
        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
                // Off by default in ExoPlayer.Builder -- without this, audio
                // keeps playing out of the phone's speaker when a Bluetooth
                // device disconnects, instead of pausing like the system
                // expects for ACTION_AUDIO_BECOMING_NOISY.
                .setHandleAudioBecomingNoisy(true)
                .build();
        player.addListener(playerListener);

        ServerProfile initialProfile = resolver.getActiveProfile();
        if (initialProfile != null) {
            player.setMediaItem(buildLiveMediaItem(initialProfile));
        }

        // Without this, the system media notification's tap target has
        // nothing to launch -- MediaSessionService doesn't default to
        // reopening the app that owns the session.
        PendingIntent sessionActivity = PendingIntent.getActivity(
                this, 0, new Intent(this, PlaybackActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        mediaSession = new MediaSession.Builder(this, player)
                .setBitmapLoader(new AuthArtBitmapLoader(resolver))
                .setCallback(new RestrictSkipCallback())
                .setSessionActivity(sessionActivity)
                .build();

        resolver.addListener(this);

        // Runs for the service's whole lifetime, not gated on isPlaying --
        // the main screen shows now-playing info as soon as it's open,
        // before the user presses Play, so metadata can't wait for actual
        // playback to start.
        metadataPoller = new MetadataPoller(new ApiClient(resolver), this::onNowPlaying);
        metadataPoller.start();
    }

    private MediaItem buildLiveMediaItem(ServerProfile profile) {
        return new MediaItem.Builder()
                .setMediaId(LIVE_MEDIA_ID)
                .setUri(Uri.parse(profile.getStreamUrl()))
                .setMediaMetadata(new MediaMetadata.Builder()
                        .setTitle(getString(R.string.app_name))
                        .build())
                .build();
    }

    /**
     * Called on the main thread whenever ActiveProfileResolver resolves a
     * different profile than before (including the very first resolution).
     * If a track is currently loaded, replaceMediaItem forces ExoPlayer to
     * tear down and reopen the HTTP connection against the new host -- the
     * player naturally rejoins at the new server's live edge. A brief
     * audible gap on failover is expected and correct: there's no
     * "position" to preserve across two different live servers. If nothing
     * is playing yet, this is a silent no-op -- Play just connects to the
     * right place next time it's pressed.
     */
    @Override
    public void onActiveProfileChanged(@Nullable ServerProfile profile) {
        if (profile == null) return;
        String newUri = profile.getStreamUrl();
        MediaItem current = player.getCurrentMediaItem();
        if (current != null && newUri.equals(current.localConfiguration != null ? current.localConfiguration.uri.toString() : null)) {
            return; // only credentials changed -- header refreshes on next reconnect, no rebuild needed
        }
        MediaItem updated = buildLiveMediaItem(profile);
        if (current == null) {
            player.setMediaItem(updated);
        } else {
            player.replaceMediaItem(player.getCurrentMediaItemIndex(), updated);
        }
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
            // A handoff joins names with " & "; only the first persona's
            // photo is shown for that rare case. Not every persona has a
            // photo yet -- a missing one 404s and AuthArtBitmapLoader
            // already treats that as "nothing to show".
            String persona = nowPlaying.dj.split(" & ")[0].toLowerCase(Locale.US);
            // Deliberately relative -- see AuthArtBitmapLoader's class doc.
            metadata.setArtworkUri(Uri.parse("/dj-photos/" + persona));
        } else if (nowPlaying.track != null) {
            Track track = nowPlaying.track;
            metadata.setTitle(track.title);
            metadata.setArtist(track.artist);
            metadata.setAlbumTitle(track.album);
            if (track.artUrl != null) {
                metadata.setArtworkUri(Uri.parse(track.artUrl));
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
        if (resolver != null) resolver.removeListener(this);
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
