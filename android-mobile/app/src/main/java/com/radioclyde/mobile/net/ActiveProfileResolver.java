package com.radioclyde.mobile.net;

import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;

import com.radioclyde.mobile.settings.ProfileRepository;
import com.radioclyde.mobile.settings.ServerProfile;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Decides which of the two configured server profiles (Internal/External) is
 * actually reachable right now, so the rest of the app can build URLs off
 * getActiveProfile() without caring which network the device is on. This is
 * the one piece of real architecture this app adds beyond the TV app's
 * single fixed SettingsRepository, which never had a "which server" question
 * to answer.
 *
 * getActiveProfile() never blocks; it returns whatever the last completed
 * probe resolved (or null before the first probe / if nothing is usable).
 * Re-probing is triggered by requestProbe() (app foreground, rate-limited)
 * and reportFailure() (repeated API/stream failures) -- see PlaybackActivity
 * and PlaybackService for the call sites. Deliberately no
 * ConnectivityManager.NetworkCallback: a network-change callback doesn't by
 * itself say which server is reachable, an HTTP probe is still required
 * after it fires, and the triggers above already catch a real network
 * change within one poll cycle or so.
 */
public class ActiveProfileResolver {

    public interface Listener {
        void onActiveProfileChanged(@Nullable ServerProfile profile);
    }

    private static final int CONNECT_TIMEOUT_MS = 3000;
    private static final int READ_TIMEOUT_MS = 4000;
    private static final long PROBE_FUTURE_TIMEOUT_MS = CONNECT_TIMEOUT_MS + READ_TIMEOUT_MS + 1000;
    private static final long MIN_PROBE_INTERVAL_MS = 30_000;
    private static final int FAILURE_THRESHOLD = 2;

    private final ProfileRepository profileRepository;

    // Single thread that runs probe() end-to-end (rate-limiting/orchestration);
    // a separate small pool actually makes the two HTTP calls concurrently.
    // Keeping these separate matters: if probe() submitted its two HTTP
    // checks to the same pool it runs on, a 2-thread pool would only have
    // one thread left to run them, serializing what's meant to be parallel.
    private final ExecutorService orchestrator = Executors.newSingleThreadExecutor();
    private final ExecutorService probePool = Executors.newFixedThreadPool(2);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private final AtomicInteger consecutiveFailures = new AtomicInteger(0);

    private volatile ServerProfile activeProfile;
    private volatile long lastProbeAtMs = 0;
    private volatile boolean probing = false;

    public ActiveProfileResolver(ProfileRepository profileRepository) {
        this.profileRepository = profileRepository;
    }

    @Nullable
    public ServerProfile getActiveProfile() {
        return activeProfile;
    }

    public void addListener(Listener listener) {
        listeners.add(listener);
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    /** @param force bypass the 30s rate limit -- used for user-initiated screens (Settings) and error-driven reprobes. */
    public void requestProbe(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastProbeAtMs < MIN_PROBE_INTERVAL_MS) return;
        if (probing) return;
        probing = true;
        lastProbeAtMs = now;
        orchestrator.execute(this::probe);
    }

    public void reportSuccess() {
        consecutiveFailures.set(0);
    }

    /** Two consecutive real failures force an immediate reprobe -- one blip isn't enough to assume the network changed. */
    public void reportFailure() {
        if (consecutiveFailures.incrementAndGet() >= FAILURE_THRESHOLD) {
            consecutiveFailures.set(0);
            requestProbe(true);
        }
    }

    private void probe() {
        try {
            ServerProfile internal = profileRepository.getInternal();
            ServerProfile external = profileRepository.getExternal();
            boolean internalUsable = internal.isUsable();
            boolean externalUsable = external.isUsable();

            ServerProfile resolved;
            if (!internalUsable && !externalUsable) {
                resolved = null;
            } else if (internalUsable && !externalUsable) {
                resolved = internal;
            } else if (!internalUsable) {
                resolved = external;
            } else {
                // Both configured -- probe concurrently, Internal wins when both answer.
                Future<Boolean> internalReachable = probePool.submit(() -> isReachable(internal));
                Future<Boolean> externalReachable = probePool.submit(() -> isReachable(external));
                if (getQuietly(internalReachable)) {
                    resolved = internal;
                } else if (getQuietly(externalReachable)) {
                    resolved = external;
                } else {
                    // Neither answered this round -- likely transient (server
                    // restart, brief signal loss). Stay on the last known-good
                    // profile rather than nulling everything out; default to
                    // Internal if this is the very first probe.
                    resolved = activeProfile != null ? activeProfile : internal;
                }
            }
            setActiveProfile(resolved);
        } finally {
            probing = false;
        }
    }

    private boolean isReachable(ServerProfile profile) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(profile.getBaseUrl() + "/api/now-playing");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            if (profile.hasCredentials()) {
                connection.setRequestProperty("Authorization",
                        AuthHeader.buildBasicAuthValue(profile.username, profile.password));
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return false;
            // Cheap sanity check that this is actually our API and not some
            // other device that happens to answer on a reused DHCP IP.
            Object parsed = new JSONTokener(HttpUtil.readBody(connection.getInputStream())).nextValue();
            return parsed instanceof JSONObject;
        } catch (Exception e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static boolean getQuietly(Future<Boolean> future) {
        try {
            return future.get(PROBE_FUTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            return false;
        }
    }

    private void setActiveProfile(@Nullable ServerProfile resolved) {
        ServerProfile previous = activeProfile;
        activeProfile = resolved;
        boolean changed = previous == null ? resolved != null : !previous.equals(resolved);
        if (changed) {
            mainHandler.post(() -> {
                for (Listener listener : listeners) {
                    listener.onActiveProfileChanged(resolved);
                }
            });
        }
    }
}
