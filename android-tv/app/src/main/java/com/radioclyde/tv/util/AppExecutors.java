package com.radioclyde.tv.util;

import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Shared background executor + main-thread poster for UI-layer network
 * calls (PlaybackActivity's polling, the settings screen's connect probe).
 * The playback service's own metadata poller and art loader own dedicated
 * executors instead, since their lifecycle is tied to the service, not the
 * app process broadly.
 */
public final class AppExecutors {

    private static final ExecutorService BACKGROUND = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private AppExecutors() {}

    public static void runOnBackground(Runnable task) {
        BACKGROUND.execute(task);
    }

    public static void runOnMain(Runnable task) {
        MAIN.post(task);
    }
}
