package com.radioclyde.mobile.net;

import com.bumptech.glide.load.model.GlideUrl;
import com.bumptech.glide.load.model.LazyHeaders;
import com.radioclyde.mobile.settings.ServerProfile;

/**
 * Row/card artwork (History list, On Air card) is loaded via Glide, since
 * those views are recycled during scrolling, so the auth header needs to be
 * attached per-request. Takes the resolved ServerProfile at call time
 * (rather than holding a reference) so a mid-session profile switch can't
 * pair a stale host with new credentials -- see AuthArtBitmapLoader for the
 * matching reasoning on the session/notification art path.
 */
public final class GlideAuthHeaderFactory {

    private GlideAuthHeaderFactory() {}

    /** @param artUrl absolute URL, i.e. profile.getBaseUrl() + a relative path */
    public static GlideUrl buildGlideUrl(String artUrl, ServerProfile profile) {
        LazyHeaders.Builder headers = new LazyHeaders.Builder();
        if (profile.hasCredentials()) {
            headers.addHeader("Authorization", AuthHeader.buildBasicAuthValue(profile.username, profile.password));
        }
        return new GlideUrl(artUrl, headers.build());
    }
}
