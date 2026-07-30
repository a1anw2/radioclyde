package com.radioclyde.tv.net;

import com.bumptech.glide.load.model.GlideUrl;
import com.bumptech.glide.load.model.LazyHeaders;
import com.radioclyde.tv.settings.SettingsRepository;

/**
 * /api/art/:ratingKey sits behind the same Basic-auth gate as everything
 * else on the station server, so Leanback row artwork (loaded via Glide,
 * since ImageCardViews are recycled constantly during D-pad scroll) needs
 * the header attached per-request too.
 */
public final class GlideAuthHeaderFactory {

    private GlideAuthHeaderFactory() {}

    /** @param artUrl absolute URL, i.e. settings.getBaseUrl() + track.artUrl */
    public static GlideUrl buildGlideUrl(String artUrl, SettingsRepository settings) {
        LazyHeaders headers = new LazyHeaders.Builder()
                .addHeader("Authorization", AuthHeader.buildBasicAuthValue(settings.getUsername(), settings.getPassword()))
                .build();
        return new GlideUrl(artUrl, headers);
    }
}
