package com.radioclyde.mobile.playback;

import androidx.annotation.NonNull;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.common.util.UnstableApi;
import com.radioclyde.mobile.net.ActiveProfileResolver;
import com.radioclyde.mobile.net.AuthHeader;
import com.radioclyde.mobile.settings.ServerProfile;

import java.util.HashMap;
import java.util.Map;

/**
 * Wraps DefaultHttpDataSource.Factory and re-reads the Basic auth header
 * from the currently active profile on every createDataSource() call --
 * ExoPlayer calls this each time it opens a new upstream connection to
 * /stream, so a profile switch (credentials or host both) is picked up on
 * the *next* reconnect. This factory only supplies headers, not the URI --
 * keeping the MediaItem's URI in sync when the host itself changes is
 * PlaybackService's job (see its ActiveProfileResolver.Listener).
 */
@UnstableApi
public class AuthenticatedHttpDataSourceFactory implements HttpDataSource.Factory {

    private final ActiveProfileResolver resolver;
    private final Map<String, String> extraHeaders = new HashMap<>();

    public AuthenticatedHttpDataSourceFactory(ActiveProfileResolver resolver) {
        this.resolver = resolver;
    }

    @NonNull
    @Override
    public HttpDataSource createDataSource() {
        Map<String, String> headers = new HashMap<>(extraHeaders);
        ServerProfile profile = resolver.getActiveProfile();
        if (profile != null && profile.hasCredentials()) {
            headers.put("Authorization", AuthHeader.buildBasicAuthValue(profile.username, profile.password));
        }
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
