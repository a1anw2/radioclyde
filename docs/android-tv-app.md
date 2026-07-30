# Android TV app (`android-tv/`)

A native Java/Leanback Google TV app for the station, living in this repo at
`android-tv/` as a fully independent Android Studio project (own Gradle
build, own git-ignorable build output) alongside the Node.js station server.
This doc describes the app's *current* shape after several redesign passes —
treat it as the source of truth over the original build plan, which is now
historical.

## What it does

One screen (`PlaybackActivity`), which is also the launcher/home screen:

- **Left column**: station logo + current show name (in a card), an analog
  clock, current weather (°F/°C), and three transport buttons — Play/Pause,
  Exit, Settings.
- **Right column**: an "On Air" now-playing card (art, track title/artist,
  a live elapsed/duration progress bar) and a "Recently Played" list below
  it.

Opening the app shows all of this immediately from server polling — audio
does **not** auto-start. The user explicitly presses Play. This was a
deliberate late change (see "Always-on metadata polling" below): the screen
needs to work as a glanceable "what's on air" display even when nobody wants
sound coming out of the TV.

There is no other screen besides Settings (a `GuidedStepSupportFragment`
flow for server host/port + Basic auth credentials, reached via the gear
icon or automatically on first run / whenever unconfigured).

## Backend contract

The app is a pure client of the existing Fastify server in `src/server/` —
no server logic lives in the app, and the app assumes nothing about the
server beyond its HTTP API. Endpoints consumed (all behind the same
Basic-auth gate as everything else on that server — see `src/server/auth.js`):

| Endpoint | Used for |
|---|---|
| `GET /stream` | the actual Icecast-proxied audio, played by ExoPlayer |
| `GET /api/now-playing` | show/track/dj state, polled every 12s |
| `GET /api/history?limit=N` | "Recently Played" list |
| `GET /api/art/:ratingKey` | album art (needs the same auth header) |
| `GET /api/weather` | added *for this app* — `src/server/weatherApi.js`, wraps `src/director/weather.js`'s `fetchCurrentWeather()`, server-side cached 10 minutes since it's a decorative, slow-changing value and Open-Meteo is a free/unauthenticated API |

The client always sends the `Authorization: Basic` header on every request
regardless of network (LAN vs Tailscale) — the server's auth hook ignores
the header entirely on trusted-IP requests, so this is always safe and
avoids any client-side network-detection logic.

## Package layout

```
com.radioclyde.tv/
  RadioTvApplication.java       trivial Application subclass
  model/                        hand-written fromJson(JSONObject) POJOs, no reflection
    JsonUtil.java                shared null-safe string reader (see gotcha below)
    NowPlaying, Station, Show, Track, HistoryEntry, UpcomingShow, Weather
  net/
    AuthHeader.java               builds the Basic auth header value
    ApiClient.java                blocking HTTP client for the 5 GETs above
    GlideAuthHeaderFactory.java   wraps a URL + the auth header as a GlideUrl
  settings/
    SettingsRepository.java       SharedPreferences wrapper; the only source of server config
    SettingsActivity.java         hosts the guided-step flow
    ServerAddressStepFragment.java, CredentialsStepFragment.java
  playback/                      the foreground MediaSessionService
    PlaybackService.java          ExoPlayer + MediaSession + metadata poller
    AuthenticatedHttpDataSourceFactory.java   attaches auth header to the /stream connection
    AuthArtBitmapLoader.java      Media3's BitmapLoader contract, for session/notification art
    MetadataPoller.java           the 12s /api/now-playing polling loop
  ui/
    PlaybackActivity.java         the one screen (launcher activity)
    AnalogClockView.java          hand-drawn clock face (see gotcha below)
    HistoryAdapter.java           plain RecyclerView adapter for the history list
  util/
    AppExecutors.java             shared background executor + main-thread poster
```

No `MainActivity`, no Leanback `BrowseSupportFragment`/`ImageCardView`
browse screen, no `PlaybackSupportFragment` — all of that existed in earlier
iterations and was deliberately removed once `PlaybackActivity` grew to
cover everything they did. `androidx.leanback` is still a dependency, but
only for `GuidedStepSupportFragment` (Settings) at this point.

## Key design decisions

**Why not Leanback's `PlaybackSupportFragment`?** It was the initial
approach, but its stock playback-controls-overlay-over-a-video-surface
paradigm doesn't fit "two-column dashboard with a clock and a list," and its
`LeanbackPlayerAdapter` bridge (see gotcha below) doesn't even forward
metadata changes. `PlaybackActivity` is a plain `FragmentActivity` with a
hand-built two-pane XML layout (`activity_playback.xml`) instead, driving
everything directly off a `MediaController`.

**Why a foreground `MediaSessionService`?** So audio keeps playing when the
app is backgrounded, and the TV remote's transport keys / lock-screen
controls work via the platform's normal MediaSession routing — no custom key
handling needed. `PlaybackService` owns the single `ExoPlayer` instance and
`MediaSession`; `PlaybackActivity` only ever talks to it through a
`MediaController`.

**Always-on metadata polling.** `MetadataPoller` used to start/stop with
`Player.isPlaying()`. Once `PlaybackActivity` became the always-shown
default screen meant to display "what's on air" *before* the user presses
Play, that gating was removed — `PlaybackService.onCreate()` starts the
poller unconditionally and it runs for the service's whole lifetime,
independent of playback state.

**Metadata carried via `MediaMetadata.extras`.** `title`/`artist`/`artworkUri`
map naturally to track fields, but "show name" and the track-progress
timestamps (`playedAtEpochMs`, `durationMs`) don't fit any standard
`MediaMetadata` field, so they ride in the `extras` `Bundle` under keys
defined as `public static final String EXTRA_*` constants on
`PlaybackService` — read on the client via
`controller.getMediaMetadata().extras`.

**History dedup is polled together, not derived from push state.** The
currently-airing track is always `history[0]` too. Skipping it needs to
happen using data fetched *in the same tick* as the history fetch — a
separate `apiClient.fetchNowPlaying()` call inside `PlaybackActivity.poll()`,
not a flag set asynchronously from the service's independently-timed
`MediaMetadata` push (that was tried first and produced a visible race: the
duplicate flashed on screen when the history fetch won the race against the
metadata listener catching up). `public/app.js` (the web player) and
`MainBrowseFragment`-equivalent logic follow the same pattern for the same
reason.

**No Retrofit/Gson/OkHttp.** The API surface is five small, flat, stable
JSON shapes — plain `HttpURLConnection` + `org.json` (already inside
`android.jar`, zero added dependency) is sufficient. Glide is used for
row/card artwork specifically (cancellation-on-recycle matters when views
are recycled during scrolling/navigation); the session/notification art
loader (`AuthArtBitmapLoader`) uses plain `HttpURLConnection` instead since
it's a one-shot fetch from a bare service context, not a recycling view.

## Gotchas already hit (don't reintroduce these)

- **`org.json`'s `optString(key, fallback)` does not return `fallback` for
  an explicit JSON `null` value** — only for an *absent* key. A present key
  with value `null` (e.g. `"dj": null` when a track is playing) comes back
  as the literal string `"null"`, not Java `null`. Every nullable string
  field must go through `JsonUtil.optNullableString()`, which checks
  `json.isNull(key)` first. Symptom when this regresses: UI shows things
  like "null talking" instead of falling back correctly.

- **`java.time.Instant.parse()` only accepts a literal `Z` UTC suffix.** The
  server sends `playedAt` with a numeric zone offset (e.g.
  `"2026-07-29T17:39:36.019-04:00"`), which `Instant.parse()` throws on.
  `Track.playedAtEpochMs()` must use `OffsetDateTime.parse(...).toInstant()`
  instead. This silently degraded (caught exception → -1 → progress UI just
  omitted) rather than crashing, so it went unnoticed for a while — if a
  progress bar or elapsed/duration text is unexpectedly blank, check this
  first.

- **`androidx.media3.ui.leanback.LeanbackPlayerAdapter` does not forward
  `Player.onMediaMetadataChanged`** to the Leanback glue — only play-state,
  buffering, and error events. This is *why* Leanback's playback fragment
  was abandoned in favor of the custom screen; if Leanback playback UI is
  ever reintroduced, metadata display needs its own `Player.Listener`, not
  reliance on the adapter.

- **`PlaybackControlsRow.MultiAction` is abstract** and has no `INDEX_ON`
  constant (that's only on concrete subclasses like `PlayPauseAction`) — a
  trivial subclass is required to instantiate a custom action. Irrelevant
  now that Leanback playback controls are gone, but the vector icons
  (`ic_play`, `ic_pause`, `ic_exit`, `ic_settings`) from that era remain.

- **`Glide.with(context)` throws `IllegalArgumentException` if the hosting
  Activity/Fragment is already destroyed** (e.g. views recycled during
  low-memory teardown while navigating away). Any Glide call from a
  `Presenter`/`Adapter`'s bind-or-unbind path needs a try/catch around it —
  see `HistoryAdapter`.

- **A plain `kill`/`SIGTERM` does not trigger a systemd unit's
  `Restart=on-failure`** — that policy explicitly excludes normal signal
  termination. Irrelevant to the app itself, but bit the station server
  (`radioclyde-web`/`radiocylde-scheduler`) during this same work: restarting
  those services to pick up code changes needs an actual
  `systemctl restart`, not a manual kill.

## Build & deploy

No JDK/Android SDK ships with a normal checkout of this repo. The toolchain
used during development lives outside the repo (so it survives independently
of any `git clean`):

```
JAVA_HOME=/home/ai/dev-tools/jdk-17.0.20+8
ANDROID_HOME=/home/ai/dev-tools/android-sdk
Gradle:  /home/ai/dev-tools/gradle-8.7/bin/gradle
```

```bash
export JAVA_HOME=/home/ai/dev-tools/jdk-17.0.20+8
export ANDROID_HOME=/home/ai/dev-tools/android-sdk
export PATH="$JAVA_HOME/bin:/home/ai/dev-tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$PATH"

cd android-tv
gradle assembleDebug
adb connect <tv-ip>:<network-debugging-port>   # port shown under Developer options, not always 5555
adb -s <tv-ip>:<port> install -r app/build/outputs/apk/debug/app-debug.apk
adb -s <tv-ip>:<port> shell am start -n com.radioclyde.tv/.ui.PlaybackActivity
```

`android-tv/local.properties` (gitignored) must contain `sdk.dir=<ANDROID_HOME>`.

No Play Store, no release signing — debug APK sideloaded via adb during
development; the intended production path is dropping the APK on a Synology
share and installing from the TV itself via a file manager app (X-plore/
Solid Explorer) that can install directly from SMB.

## Config not derivable from git

Basic auth username/port/host are entered on-device via Settings, backed by
`SharedPreferences` — nothing hardcoded, nothing in this repo. The device
used for testing was a Google TV Streamer at a static LAN IP.
