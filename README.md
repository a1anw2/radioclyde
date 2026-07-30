# radiocylde

Orchestration scripts for a self-hosted AI DJ internet radio station:
Liquidsoap + Icecast for the actual stream, an LM Studio model for
scriptwriting/track-query decisions, and Chatterbox for DJ speech synthesis.
Plex is the music library backend.

At a high level: `station.json` (outside this repo, under `dataDir`) defines
a weekly lineup of shows plus the station's personality (station name,
filler curation) — `config.json` is core/operational settings only (Plex
token, Icecast credentials, etc.), station.json is everything about *this*
station's identity. A single long-running daemon (`src/scheduler/scheduler.js`)
watches the clock and, for each upcoming occurrence, triggers two phases:

1. **Produce** (`src/producer/generateScript.js`) — turns a show's prose
   brief (`show-descriptions/*.md`) into a validated `.script.md`: picks real
   tracks from Plex, researches facts, and writes every DJ move. See
   [script-format.md](script-format.md) for the output grammar and
   [docs/producer-pipeline.md](docs/producer-pipeline.md) for why it's built
   as a multi-phase pipeline rather than one open-ended agent loop.
2. **Direct** (`src/director/index.js`) — turns a finished script into real
   broadcast assets: synthesizes/caches DJ audio via Chatterbox, resolves
   `live` segments (time/weather) fresh, and assembles `playlist.m3u`.

`src/scheduler/updateNowPlaying.js` then points Liquidsoap's
`now_playing.m3u` at whichever occurrence should be on air, and
`liquidsoap/radio.liq` falls back to a shuffled library-wide filler playlist
(`src/scheduler/generateFillerPlaylist.js`, regenerated periodically)
whenever there's nothing queued.

`station.json` can also declare a `downtime` window (e.g.
`{ "start": "00:00", "end": "07:00" }`) — a stretch of each day where
nothing airs and filler plays. While the clock is inside it,
`src/scheduler/scheduleScripts.js` widens its horizon to produce scripts for
the *whole* upcoming broadcast day at once (rather than trickling out one
show at a time on `scriptLeadTimeMinutes`), and
`src/scheduler/schedulePrewarmAudio.js` synthesizes and caches every show's
DJ speech (`src/director/prewarmAudio.js`) the same way — front-loading the
heavy LLM/TTS work onto the hours nobody's listening. Directing itself still
happens near air time on its usual `directLeadTimeMinutes` clock (unchanged)
so `live` segments (weather/time) are always resolved fresh, close to when
they're actually spoken — direct just finds the DJ-audio cache already warm
and has far less work left to do. A station with no `downtime` configured
behaves exactly as before this existed.

## Setup

1. `npm install`
2. Copy `config.example.json` to `config.json` and fill in real values
   (Plex token, Icecast credentials, LM Studio/Chatterbox URLs, personas,
   etc.) — `config.json` is gitignored since it holds secrets.
3. Point `dataDir` in `config.json` at wherever `station.json`,
   `show-descriptions/*.md`, and all generated output should live — this is
   deliberately kept outside the repo. See [sample-data/](sample-data/) for a
   working example to copy as a starting point.
4. Run the scheduler (`npm run runstation`, or install
   `radiocylde-scheduler.service` via systemd for production).

## Writing a show's Track Selection brief

Each `show-descriptions/*.md` file has a `## Track Selection` section: plain
prose, not a config format. It's read by `src/producer/trackSelection/query.js`,
which uses an LLM to turn it into a structured Plex query
(`src/producer/trackSelection/queue.js` then runs that query — no AI
involved past this one step). Things you can
say there:

- **Artist / genre / decade** — at least one is required (unless using album
  keyword, below). Genre gets matched to the closest real tag in this Plex
  library (you don't need to know Plex's internal tag names — "80s rock"
  resolves to whatever this library actually calls it, e.g. "Pop/Rock"). All
  three can combine (e.g. genre + decade).
- **Album keyword** — for a brief naming a compilation/branding rather than a
  real genre tag (e.g. "Disney" — this library has no Disney genre, but does
  have albums titled things like "Ultimate Disney"), say so directly (e.g.
  "only from albums with Disney in the title") and it matches by album-title
  substring instead.
- **Folder** — for a brief scoped to one specific library folder (e.g. "only
  from /volume1/media/_soundtrack"), name the path directly and it matches by
  filesystem path substring. Works with `singleAlbum` too — tracks under the
  folder get grouped by album title into pseudo-albums (folder-organized
  soundtrack libraries don't credit one consistent artist per album, so
  grouping is by title, not artist+title).
- **Album genre** — a separate, richer tag vocabulary from plain genre in
  this library (includes tags like "Instrumental" that don't exist at the
  track level at all). Say so explicitly (e.g. "use the album genre
  Classical") and it resolves via `albumGenre` instead of `genre`.
- **A theme spanning many named artists** (e.g. "female vocalists") — there's
  no such metadata in this library (only Genre/Country/artist/album/decade),
  so a brief like this gets resolved to a list of real artist names instead
  (`artistList`); whichever of those actually exist in the library get
  pooled together. Say the theme plainly in the brief and let the AI query
  step pick real, well-known artists who fit — it isn't scoped to a fixed
  vocabulary the way genre is, so results depend on the model's judgment.
- **Exclusions** — vague concepts are fine ("no christmas tracks", "nothing
  from soundtracks or compilation albums") and get expanded into concrete
  keyword matches against title/album/genre.
- **Repeat behavior** — "don't repeat the same artist" (meaningful for
  genre/decade shows; a no-op for single-artist shows, which repeat the
  artist by definition) or "spread across different albums" for a
  single-artist show that still wants catalog variety.
- **Popularity weighting** — "favor well-known tracks" biases toward more
  popular tracks without excluding deep cuts outright.
- **Max track length** — a plain cap, e.g. "no tracks over 5 minutes" or
  "radio edits only, under 3:30".

Iterate on a brief without touching `station.json` or waiting for the
scheduler using the preview tools below (`preview-tracks` is the fast one —
brief in, tracklist out).

## npm scripts

Pipeline (normally only invoked by the scheduler, not by hand):

- `npm run runstation` — the long-running daemon; owns every timing decision.
- `npm run generate-script -- --id=<showId>` — runs the producer for one show.
- `npm run direct-show -- --id=<showId> --weekday=<weekday> --date=<yyyy-mm-dd> --time=<HH:MM>` — runs the director for one occurrence.
- `npm run prewarm-show-audio -- --id=<showId> [--weekday=<weekday> --date=<yyyy-mm-dd>]` — warms a show's dj-audio cache ahead of time (the downtime job's own per-show step).
- `npm run update-now-playing` — points `now_playing.m3u` at whatever should be airing.
- `npm run generate-filler-playlist` — rewrites the off-air filler pool.

Preview/dry-run tools, for iterating on a show while designing it (no
station.json entry required):

- `npm run preview-tracks -- <show-name>` — the fast one: resolves
  `show-descriptions/<show-name>.md`, pulls its `## Track Selection` text
  and `**Duration:**`, and prints the AI-produced Plex query plus the
  resulting tracklist. Also accepts a full/relative path, or
  `--text="<brief>" --duration=<minutes>` for a brief with no file at all.
  (`preview-track-query-ai` is the same script, longer name.)
- `npm run preview-track-queue -- --duration=<minutes> [--artist=... --genre=... --decade=...]` — the deterministic track-selection step directly, bypassing the AI query-producing step entirely.
- `npm run preview-show-prep -- --file=<path> --duration=<minutes>` — the fuller show-prep dry run (track query + research), still short of full script writing.

## Further reading

- [docs/README.md](docs/README.md) — design rationale and empirical notes
  for the producer/director pipeline.
- [script-format.md](script-format.md) — the `.script.md` grammar.
