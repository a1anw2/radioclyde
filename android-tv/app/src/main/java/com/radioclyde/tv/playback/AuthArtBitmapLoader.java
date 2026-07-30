package com.radioclyde.tv.playback;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import androidx.media3.common.util.BitmapLoader;
import androidx.media3.common.util.UnstableApi;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.SettableFuture;
import com.radioclyde.tv.net.AuthHeader;
import com.radioclyde.tv.settings.SettingsRepository;

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
 * Service context, not a scrolling card grid, so Glide's lifecycle/caching
 * machinery isn't needed here, and album art still needs the same Basic
 * auth header as everything else on the station server.
 */
@UnstableApi
public class AuthArtBitmapLoader implements BitmapLoader {

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 8000;

    private final SettingsRepository settings;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public AuthArtBitmapLoader(SettingsRepository settings) {
        this.settings = settings;
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
    public ListenableFuture<Bitmap> loadBitmap(Uri uri) {
        SettableFuture<Bitmap> future = SettableFuture.create();
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(uri.toString()).openConnection();
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                connection.setRequestProperty("Authorization",
                        AuthHeader.buildBasicAuthValue(settings.getUsername(), settings.getPassword()));

                try (InputStream in = connection.getInputStream()) {
                    Bitmap bitmap = BitmapFactory.decodeStream(in);
                    if (bitmap == null) {
                        future.setException(new IOException("Failed to decode bitmap from " + uri));
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
