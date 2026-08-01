# Android mobile app (`android-mobile/`)

A native Java phone/tablet app for the station, living in this repo at
`android-mobile/` as a fully independent Android Studio project (own Gradle
build, own package `com.radioclyde.mobile`, own git-ignorable build output)
alongside the Node.js station server and the Android TV app (`android-tv/`).
No shared library module between the two Android projects — code is copied
and adapted, matching how `android-tv/` already stood alone before this app
existed. See [android-tv-app.md](android-tv-app.md) for the TV app this one
is modeled on; this doc only covers what's actually different.

## What it does

Same dashboard concept as the TV app (station logo/show name, an "On Air"
now-playing card with art/title/artist/progress bar, a Recently Played
list, Play/Pause), but:

- **Touch UI, not Leanback/D-pad** — a single-column phone layout
  (`PlaybackActivity`), `AppCompatActivity`/Material components throughout,
  no `androidx.leanback` dependency at all.
- **No clock, no weather** — both present in the TV app, deliberately
  dropped here.
- **Two server profiles, auto-selected by reachability**, instead of the TV
  app's one fixed host/port/credentials config — see below, this is the
  real architectural difference from the TV app.

Settings (gear icon in the toolbar) is a plain scrolling form, not the TV
app's `GuidedStepSupportFragment` wizard — that widget is Leanback-only.

## Two profiles + `ActiveProfileResolver`

The station's Fastify server (`src/server/`, same backend as the TV app
talks to) is reachable two ways depending on where the phone actually is:
from the station's own LAN, `src/server/auth.js`'s auth hook is skipped
entirely for IPs in `config.web.trustedNetworks`; from anywhere else it's
enforced. The TV app only ever lives on one fixed network, so it only ever
needed one config. A phone moves — so this app stores two named profiles
(`com.radioclyde.mobile.settings.ServerProfile`/`ProfileRepository`) and
picks whichever is actually reachable right now:

- **Internal**: host + port only (e.g. `192.168.1.159:8000`), plain HTTP,
  no credentials — the trusted-LAN path.
- **External**: host + username + password, HTTPS by default, **no port
  field** — always the scheme's standard port (443), since an
  internet-facing deployment realistically sits behind a reverse proxy/TLS
  termination on the standard port, not some LAN-only high port.

`com.radioclyde.mobile.net.ActiveProfileResolver` (app-process-scoped
singleton, owned by `RadioMobileApplication`) decides which one is active:

- Probes `GET /api/now-playing` against both configured profiles
  **concurrently** (own 2-thread pool, 3s connect / 4s read timeouts —
  tighter than `ApiClient`'s normal 5s/8s, since this must fail fast to try
  the other profile), success = 2xx *and* the body actually parses as a
  JSON object (cheap guard against some other device answering on a reused
  DHCP IP). Internal wins when both answer.
- `getActiveProfile()` never blocks — returns the last-resolved profile, or
  `null` before the first probe / when nothing's reachable. Every caller
  must null-check this; unlike the TV app's always-non-null
  `SettingsRepository`, `null` is a normal, recurring state here.
- Re-probe triggers, deliberately just these two (no
  `ConnectivityManager.NetworkCallback` — a network-change callback doesn't
  itself say which server is reachable, an HTTP probe is still required
  after it fires, and these two already catch a real network change within
  a poll cycle or so): app foreground (`PlaybackActivity.onStart()`,
  rate-limited to once/30s), and two consecutive `ApiClient` failures or a
  single ExoPlayer `onPlayerError` (ApiClient centralizes
  `reportSuccess()`/`reportFailure()` since every poller goes through it).
- `Listener` interface (`onActiveProfileChanged`) lets `PlaybackService` and
  the UI react instead of polling the resolver themselves.

Every class that used to hold the TV app's flat `SettingsRepository`
(`ApiClient`, `AuthenticatedHttpDataSourceFactory`, `AuthArtBitmapLoader`,
`GlideAuthHeaderFactory`, `HistoryAdapter`) instead takes the resolver and
asks for `getActiveProfile()` fresh on every call — same "always re-read,
never cache" pattern the TV app already used for its single config, just
now resolving to one of two possible profiles instead of one fixed one.

**Artwork/track URIs are kept relative** (e.g. `track.artUrl` as-is)
through `MediaMetadata`/`HistoryEntry`, resolved to an absolute URL only at
actual fetch time in `AuthArtBitmapLoader`/`GlideAuthHeaderFactory`/
`PlaybackActivity.loadRelativeArt()`, against whichever profile is active
*then* — not baked in at poll time like the TV app does (safe there, since
it only ever has one possible host). If they were made absolute early, a
profile switch landing between poll and fetch would pair a stale host with
the new profile's credentials.

## Package layout

```
com.radioclyde.mobile/
  RadioMobileApplication.java   owns ProfileRepository + ActiveProfileResolver singletons
  model/                        JsonUtil, NowPlaying, Station, Show, Track, HistoryEntry --
                                 near-verbatim copies of android-tv's (Weather/UpcomingShow dropped, unused)
  net/
    AuthHeader.java               shared Basic-auth header builder
    HttpUtil.java                 tiny shared response-body reader (ApiClient + ActiveProfileResolver's probe)
    ApiClient.java                blocking HTTP client for now-playing/history; takes the resolver, not a flat config
    ActiveProfileResolver.java    see above
    GlideAuthHeaderFactory.java   resolves a ServerProfile at call time, not held by reference
  settings/
    ServerProfile.java             immutable value object (id, scheme, host, port, username, password)
    ProfileRepository.java         SharedPreferences wrapper, two profiles
    SettingsActivity.java          plain touch form, not GuidedStepSupportFragment
  playback/                      the foreground MediaSessionService
    PlaybackService.java           ExoPlayer + MediaSession + metadata poller; reacts to profile changes
    AuthenticatedHttpDataSourceFactory.java   auth header only -- URI freshness is PlaybackService's job
    AuthArtBitmapLoader.java       session/notification art, resolved against the *current* active profile
    MetadataPoller.java            verbatim copy of android-tv's -- no settings dependency at all
  ui/
    PlaybackActivity.java          the one screen (launcher activity), single-column touch layout
    HistoryAdapter.java            RecyclerView adapter, resolver-aware art loading
  util/
    AppExecutors.java              verbatim copy of android-tv's
```

## Key design decisions

**Pause is really stop, for a live stream.** `PlaybackService`'s
`Player.Listener#onIsPlayingChanged(false)` calls `player.stop()` whenever
the playback state is `STATE_READY` (a real user/UI pause, as distinct from
buffering, natural end, or an error, which land in other states). Without
this, ExoPlayer keeps buffering ahead in the background while paused (fine
for on-demand media, wrong for an infinite live stream) — resuming later
replayed stale "buffered" audio instead of rejoining live. `stop()`
discards it; the next Play (from any surface — in-app button, notification,
lock screen, Bluetooth controls) re-prepares, which opens a fresh HTTP
connection and naturally rejoins live since Icecast has no seek/rewind. This
single change in one listener fixes it for every trigger path, not just the
in-app button.

**`setHandleAudioBecomingNoisy(true)`** on the `ExoPlayer.Builder` — off by
default. Without it, disconnecting a Bluetooth device kept playing audio out
of the phone's speaker instead of pausing, which is what
`ACTION_AUDIO_BECOMING_NOISY` exists for. Combines naturally with the pause
fix above: the noisy-triggered pause also stops the connection outright, so
reconnecting later (speaker or a new Bluetooth device) rejoins live too.

**`MediaSession.Builder.setSessionActivity(...)`** — without this, the
system media notification's tap target does nothing; `MediaSessionService`
doesn't default to reopening the app that owns the session. Points at
`PlaybackActivity`.

**Why not the TV app's two-step settings wizard?** `GuidedStepSupportFragment`
is Leanback-only, built for D-pad one-field-at-a-time input. A touch
keyboard makes one scrolling form with both profiles visible at once more
natural, so `SettingsActivity` is a plain `AppCompatActivity` instead.

**Why Material (`androidx.appcompat` + `com.google.android.material`)
instead of Leanback?** The TV app had zero Material dependency — Leanback
supplied all its chrome. This app drops `androidx.leanback` entirely (and
with it, android-tv's `kotlin-stdlib-jdk7/jdk8` exclusion workaround, which
existed only because of Leanback's transitive `kotlinx-coroutines`
conflict) and adds Material/AppCompat for standard toolbar/menu/form
widgets instead.

## Gotchas carried forward from android-tv (still apply here)

- `org.json`'s `optString(key, fallback)` not returning `fallback` for an
  explicit JSON `null` — every nullable string field goes through
  `JsonUtil.optNullableString()`.
- `java.time.Instant.parse()` only accepting a literal `Z` UTC suffix — the
  server sends a numeric offset, so `Track.playedAtEpochMs()` uses
  `OffsetDateTime.parse(...).toInstant()` instead.
- `Glide.with(context)` throwing if the hosting Activity/Fragment is already
  destroyed — try/catch around every Glide call in `HistoryAdapter` and
  `PlaybackActivity`.

**Not applicable here**: android-tv's Leanback-specific gotchas
(`LeanbackPlayerAdapter` not forwarding metadata,
`PlaybackControlsRow.MultiAction` being abstract) — this app never touches
`androidx.leanback`.

## Build & deploy

Same external toolchain as `android-tv/` (not checked into the repo):

```bash
export JAVA_HOME=/home/ai/dev-tools/jdk-17.0.20+8
export ANDROID_HOME=/home/ai/dev-tools/android-sdk
export PATH="$JAVA_HOME/bin:/home/ai/dev-tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$PATH"

cd android-mobile
gradle assembleDebug
adb connect <phone-ip>:<port>   # or pair over Wireless debugging first (Developer options)
adb -s <phone-ip>:<port> install -r app/build/outputs/apk/debug/app-debug.apk
adb -s <phone-ip>:<port> shell am start -n com.radioclyde.mobile/.ui.PlaybackActivity
```

`android-mobile/local.properties` (gitignored) must contain
`sdk.dir=<ANDROID_HOME>` and, same convention as `android-tv/`,
`stationAppName=<real station name>` (baked into the APK as `app_name` via
`resValue` — a build-time fallback label only; the toolbar/show-name text
shown in the app is pulled live from `/api/now-playing`'s `station.name`
field once the first poll lands).

No Play Store, no release signing — debug-signed APK, same as `android-tv/`:
sideload via `adb install` or transfer the file directly (email/cloud
drive/USB) and install from a file manager, which needs "install unknown
apps" allowed for whatever app opens it.

## Config not derivable from git

Both profiles (Internal host/port; External host/username/password/HTTPS
toggle) are entered on-device via Settings, backed by `SharedPreferences` —
nothing hardcoded, nothing in this repo.
