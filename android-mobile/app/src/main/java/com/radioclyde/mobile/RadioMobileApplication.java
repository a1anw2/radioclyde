package com.radioclyde.mobile;

import android.app.Application;

import com.radioclyde.mobile.net.ActiveProfileResolver;
import com.radioclyde.mobile.settings.ProfileRepository;

/** Owns the app-process-scoped ProfileRepository/ActiveProfileResolver singletons. */
public class RadioMobileApplication extends Application {

    private ProfileRepository profileRepository;
    private ActiveProfileResolver activeProfileResolver;

    @Override
    public void onCreate() {
        super.onCreate();
        profileRepository = new ProfileRepository(this);
        activeProfileResolver = new ActiveProfileResolver(profileRepository);
        activeProfileResolver.requestProbe(true);
    }

    public ProfileRepository getProfileRepository() {
        return profileRepository;
    }

    public ActiveProfileResolver getActiveProfileResolver() {
        return activeProfileResolver;
    }
}
