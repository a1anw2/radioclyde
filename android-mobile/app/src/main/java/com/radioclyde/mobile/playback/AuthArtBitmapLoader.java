package com.radioclyde.mobile.playback;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import androidx.media3.common.util.BitmapLoader;
import androidx.media3.common.util.UnstableApi;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.SettableFuture;
import com.radioclyde.mobile.net.ActiveProfileResolver;
import com.radioclyde.mobile.net.AuthHeader;
import com.radioclyde.mobile.settings.ServerProfile;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Media3's artwork-fetch contract for the MediaSession's system
 * notification/lock-screen art. Plain HttpURLConnection + BitmapFactory
 * (not Glide) -- this is a one-shot fetch per track change from a bare
 * Service context, not a scrolling card grid.
 *
 * The Uri passed in is always a *relative* path (e.g. "/api/art/123"), never
 * an absolute URL -- PlaybackService deliberately never bakes a host into
 * MediaMetadata.artworkUri, so this resolves against whatever profile is
 * active at the moment the fetch actually runs, not whatever was active when
 * the metadata was built. Otherwise a profile switch landing between poll
 * and fetch would pair a stale host with the new profile's credentials.
 */
@UnstableApi
public class AuthArtBitmapLoader implements BitmapLoader {

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 8000;

    private final ActiveProfileResolver resolver;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public AuthArtBitmapLoader(ActiveProfileResolver resolver) {
        this.resolver = resolver;
    }

    @Override
    public boolean supportsMimeType(String mimeType) {
        return mimeType != null && mimeType.startsWith("image/");
    }

    @Override
    public ListenableFuture<Bitmap> decodeBitmap(byte[] data) {
        SettableFuture<Bitmap> future = SettableFuture.create();
        executor.execute(() -> {
            Bitmap bitmap = BitmapFactory.decodeByteArray(data, 0, data.length);
            if (bitmap == null) {
                future.setException(new IOException("Failed to decode bitmap bytes"));
            } else {
                future.set(bitmap);
            }
        });
        return future;
    }

    @Override
    public ListenableFuture<Bitmap> loadBitmap(Uri relativeUri) {
        SettableFuture<Bitmap> future = SettableFuture.create();
        executor.execute(() -> {
            ServerProfile profile = resolver.getActiveProfile();
            if (profile == null) {
                future.setException(new IOException("No reachable server profile"));
                return;
            }
            HttpURLConnection connection = null;
            try {
                URL url = new URL(profile.getBaseUrl() + relativeUri.toString());
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                if (profile.hasCredentials()) {
                    connection.setRequestProperty("Authorization",
                            AuthHeader.buildBasicAuthValue(profile.username, profile.password));
                }

                try (InputStream in = connection.getInputStream()) {
                    Bitmap bitmap = BitmapFactory.decodeStream(in);
                    if (bitmap == null) {
                        future.setException(new IOException("Failed to decode bitmap from " + relativeUri));
                    } else {
                        future.set(bitmap);
                    }
                }
            } catch (IOException e) {
                future.setException(e);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
        return future;
    }
}
