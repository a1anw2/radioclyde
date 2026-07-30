package com.radioclyde.tv.playback;

import androidx.annotation.NonNull;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.common.util.UnstableApi;
import com.radioclyde.tv.net.AuthHeader;
import com.radioclyde.tv.settings.SettingsRepository;

import java.util.HashMap;
import java.util.Map;

/**
 * Wraps DefaultHttpDataSource.Factory and re-reads the Basic auth header
 * from SettingsRepository on every createDataSource() call -- ExoPlayer
 * calls this each time it opens a new upstream connection to /stream, so
 * changing host/credentials in Settings while the service is alive is
 * picked up on the *next* reconnect with no explicit invalidation plumbing.
 */
@UnstableApi
public class AuthenticatedHttpDataSourceFactory implements HttpDataSource.Factory {

    private final SettingsRepository settings;
    private final Map<String, String> extraHeaders = new HashMap<>();

    public AuthenticatedHttpDataSourceFactory(SettingsRepository settings) {
        this.settings = settings;
    }

    @NonNull
    @Override
    public HttpDataSource createDataSource() {
        Map<String, String> headers = new HashMap<>(extraHeaders);
        headers.put("Authorization", AuthHeader.buildBasicAuthValue(settings.getUsername(), settings.getPassword()));
        return new DefaultHttpDataSource.Factory()
                .setDefaultRequestProperties(headers)
                .createDataSource();
    }

    @NonNull
    @Override
    public HttpDataSource.Factory setDefaultRequestProperties(@NonNull Map<String, String> defaultRequestProperties) {
        extraHeaders.clear();
        extraHeaders.putAll(defaultRequestProperties);
        return this;
    }
}
