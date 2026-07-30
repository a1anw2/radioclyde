# Show Producer Pipeline

Status: track selection and research are built and live-tested. Script
writing (turning a tracklist + research into the actual `.script.md`) is
**not yet built** — everything below covers only the pipeline up to that
point.

## Why this exists

The first version of the producer was one big AI tool-calling session:
`search_tracks` + `wikipedia_lookup` + `web_search` + `finish_script`, all in
one open-ended loop, expected to research, pick tracks, budget the show's
runtime, and write the whole script in a single continuous conversation.

Live-tested against real briefs, this repeatedly failed to converge:
- A 60-minute single-artist show (`late-night-queen`) never called
  `finish_script` even once across 60 iterations — it got stuck re-querying
  paraphrased variations of the same 2-3 research questions.
- A 60-minute Elvis retrospective (`elvis-lookback`) plateaued at ~40 minutes
  of actual content against a 60-minute target, then resubmitted the
  *identical* draft 15 times in a row (including through a forced-finish
  window), before a retry attempt hit an outright LM Studio engine error.

The fix was splitting the job apart: narrow, mostly-deterministic stages
instead of one open-ended session. Only two stages touch the LLM at all now,
and both are single-shot/narrow rather than a multi-turn conversation.

## Pipeline stages

### 1. Track Selection query production (AI, narrow, single-shot)

`src/producer/trackSelection/query.js`

- **Input**: a human-authored "Track Selection" brief — prose that can mix
  clean fields ("artist: Elvis Presley") with vague concepts ("no christmas
  songs", "80s rock music").
- **Output**: a structured query — `{ artist?, genre?, decade?,
  excludeKeywords?, repeatArtist?, oneTrackPerAlbum?, weightPopular?,
  maxTrackDurationSeconds? }`.
- **Mechanism**: one forced tool call (`produce_query`), `tool_choice:
  'required'`. The real genre tag list for this library is included in the
  system prompt so the model can best-match a loose genre mention ("rock")
  to whatever this library actually calls it ("Pop/Rock"), rather than
  requiring the brief's author to know Plex's internal tag vocabulary.
- **Validation**: there's no separate validator — the produced query is fed
  directly into `buildTrackQueue()`. If it throws (bad artist name, invalid
  genre), that real error message is fed back to the model as the retry
  signal (bounded, default `maxAttempts: 4`). This reuses real Plex
  ground-truth as the validator instead of duplicating logic.
- **LM Studio quirk**: `tool_choice` only supports the strings `none` /
  `auto` / `required` — **not** OpenAI's targeted `{type:'function',
  function:{name:...}}` form (confirmed live: that form 400s on this
  server). To force one *specific* tool, shrink the `tools` array down to
  just that one entry and use `tool_choice: 'required'`. Used here for
  `produce_query`, and originally in the old single-session producer's
  forced-finish window for `finish_script`.
- Tested live against several briefs (a well-known single artist with a
  thematic exclusion; a decade+genre combo requiring genre translation and
  artist-diversity) — succeeded on the **first attempt** every time so far.
  Not yet stress-tested against adversarial/ambiguous/garbage briefs.

### 2. Deterministic track queue building (no AI at all)

`src/producer/trackSelection/queue.js`, built on `fetchCandidateTracks` in
`src/plex/tracks.js`

- **Candidate fetch + intersect**: resolves artist/genre/decade to a
  candidate list, intersecting by `ratingKey` when more than one filter is
  given. An earlier version picked one "primary" filter and silently
  ignored the rest — that's a real bug (silently drops a filter instead of
  narrowing by it) that's since been fixed.
- **Shuffling**: Plex's own default ordering is *not* random — confirmed
  live it's some fixed internal order (alphabetical-ish). Without
  shuffling, every call — and every retry within one session — saw the
  exact same leading slice of what can be a huge catalog (Elvis Presley
  alone: 1,719 tracks). Shuffled once per unique filter combination and
  cached for the life of one process: a repeated call (or a call that only
  raises `limit`) stays consistent within one run, while a fresh process
  (the next time the show runs) gets fresh randomness.
- **Popularity weighting** (`weightPopular`): Plex's music metadata agent
  attaches a real global popularity figure as `ratingCount` (confirmed
  live: low hundreds for deep cuts vs. 800k+ for well-known hits — see
  `plex-library-notes.md`). Weight = `log10(ratingCount + 10)` — log-scaled
  so a handful of blockbusters don't crowd out everything else, with a
  floor of 1 for untracked/zero tracks. Sampling uses the
  Efraimidis-Spirakis method (`key = random()^(1/weight)`, sort
  descending) — weighted sampling *without* replacement; nothing is
  excluded outright the way a strict top-N-by-weight would be.
- **Dedup by title**: compilation-heavy artists re-release the same song
  under multiple albums/`ratingKey`s (confirmed live: this library has
  "Jailhouse Rock" under at least two different catalog entries for Elvis
  Presley). Keeps only the highest-`ratingCount` instance per normalized
  title, so a show never plays "the same song" twice under two different
  catalog entries.
- **`excludeKeywords`**: matches against title + album + genre text
  (case-insensitive substring). Genre tagging alone is *not* reliable for
  something like "no Christmas songs" — see `plex-library-notes.md` for why.
- **`maxTrackDurationSeconds`**: a plain mechanical length cutoff, applied
  as a post-fetch prune here. Unlike `excludeKeywords` this *is* exposed on
  the AI query-producer's schema (2026-07-27) — the cutoff itself is
  mechanical, but the value comes from prose ("no tracks over 5 minutes",
  "radio edits only, under 3:30") that needs converting to seconds first.
- **`repeatArtist`**: defaults `true`. Only meaningful for genre/decade
  selections (an artist-type selection is 100% that one artist already, so
  the flag is a no-op there, but still needs to exist for genre/decade
  cases where the pool spans many artists).
- **Duration accumulation**: greedily accumulates tracks (real `durationMs`
  + a `djOverheadSeconds` estimate per track) until the target is reached.
  The track that crosses the threshold is *kept*, not trimmed off —
  confirmed acceptable: overshooting the target by a few minutes is fine
  ("5 min over is no problem").
- **`DEFAULT_DJ_OVERHEAD_SECONDS = 45`**: a starting estimate for
  "intro + teaser + trivia" style commentary (roughly two DJ segments per
  track), bigger than the old pipeline's ~25s-for-one-line estimate.
  **Not yet validated** against real Chatterbox-timed output for this show
  style — expect to tune once real shows have actually aired.

### 3. Per-track research (deterministic fetch + narrow non-agentic extraction)

`src/producer/research/trackResearch.js` + `src/producer/research/wikipediaCache.js`
(both new — **not** wired into the old pipeline or `wikipedia.js`'s other
existing callers)

- **Song-level lookup first** (`"<title>" <artist> song`), falling back to
  **album-level** (`<album> <artist> album`) when Wikipedia has no
  dedicated page for the song itself — the majority case for deep cuts.
- Album-level results are cached **in-memory per run** (separate from the
  on-disk cache below) so multiple tracks pulled from the same album only
  pay for one fetch + one extraction, not one per track.
- **On-disk cache** (`wikipediaCache.js`): permanent, no-expiry cache of the
  *raw* Wikipedia fetch result (title/extract), not the downstream
  extracted facts — keyed by a hash of the normalized query text. Caches
  "not found" too, so a query known to have no page isn't re-fetched every
  run. Lives at `cache/wikipedia/` (gitignored, regenerates automatically).
- **Fact extraction**: one non-agentic LLM completion per lookup — not a
  tool call, no loop — "pull out 2-3 DJ-worthy facts from this specific
  text." Same prompt shape as the old pipeline's
  `showPlanner.js:extractDjFacts`, reimplemented standalone here (not
  imported/shared) since this is deliberately independent new code.
- **Plex-metadata fallback**: when neither song- nor album-level lookup
  turns up anything, builds a plain factual line from data Plex already
  gave us for free — album + year, or just year, or genre (e.g. `From the
  1961 album "Something for Everybody."`). Not "interesting trivia," but
  means a track never has literally nothing to say about it.
- **Resilience**: a failed HTTP request (rate-limited, network hiccup) must
  *not* be treated as "not found" — caught, logged as a warning, left as
  `null` for *this run only* (nothing gets cached, since the on-disk cache
  write only happens after a genuine response). This was a real bug caught
  live: `wikipedia.js`'s `fetchSummary` used to silently `return null` on
  *any* failed HTTP request, including a 429 — which would have
  permanently poisoned the on-disk cache with false "not found" entries
  caused by a transient rate limit. Fixed: `fetchSummary` now throws on a
  failed request, only returning `null` for a genuine empty/disambiguation
  result. (This fix also incidentally improves the *old* pipeline's
  correctness — its `showPlanner.js:getFactsForTarget` already had a
  try/catch around `fetchSummary` expecting it to throw, but it never did
  before this fix, so a 429 there used to silently skip the Exa fallback
  too.)
- **Request pacing**: 300ms between each track's Wikipedia request, to
  reduce (not guarantee against) retriggering rate limiting.
- **User-Agent**: `wikipedia.js`'s requests now send a proper identifying
  `User-Agent` (`radiocylde/0.1.0 (self-hosted internet radio project,
  non-commercial)`). Wikimedia's API etiquette
  (mediawiki.org/wiki/API:Etiquette) explicitly calls out a missing/generic
  User-Agent as risking an outright **IP block**, separate from and worse
  than ordinary rate-limiting.

## Known limitations / open issues

- **Wrong-page matches**: Wikipedia's search-based disambiguation can
  confidently match the *wrong* page when there's no exact page for the
  specific thing. Confirmed live: "Seeing Is Believing" (Elvis, from *He
  Touched Me*) resolved to an unrelated compilation's page; "Trouble"
  (Elvis, from *King Creole*) resolved to a different, unrelated Elvis
  soundtrack's page. **Explicitly left unfixed** (2026-07-26 — "let's leave
  it"). A stricter check (verify the returned page's extract actually
  mentions the track/album) would catch this if it becomes a real problem.
- **No published hard Wikipedia rate limit** — confirmed via
  mediawiki.org/wiki/API:Etiquette this is a "be considerate, serial
  requests, identify yourself, exponential backoff on 429" policy, not a
  fixed quota. Third-party sites claiming a specific number (e.g. "200
  req/s") are not official and shouldn't be trusted.
- `DEFAULT_DJ_OVERHEAD_SECONDS` (45s) is an unvalidated estimate.
- Script writing itself — turning the tracklist + research into the actual
  `.script.md`, placing quiz/weather-handoff/news-roundup per "Show
  Options" — is **not yet built**.

## Preview / dry-run tools

All safe to re-run repeatedly — no writes, no side effects.

```
npm run preview-track-queue -- --artist="..." --genre="..." --decade="..." \
  --exclude=a,b --maxTrackDurationSeconds=300 --repeatArtist=true --weightPopular=true --duration=60
```
Tests `trackSelection.js` directly with hand-specified params, no AI involved.

```
npm run preview-track-query-ai -- --text="<brief>" --duration=60   # or --file=<path>
```
Tests the AI query-producer plus the resulting tracklist together.

```
npm run preview-show-prep -- --text="<brief>" --duration=60   # or --file=<path>
```
The full pipeline up to script-writing: brief → query → tracklist →
per-track research, all printed together.

## Show description file format (in progress, not finalized)

Planned structure for a show-description `.md` file (the producer's input):

```
# Name
# Description       <- full-session AI context (not just the intro line)
# Tone               <- replaces config.json's persona systemPrompt for
                         this show; still maps persona key -> voice file
                         in config.json
# Track Selection    <- the brief handed to trackQueryProducer.js
# Show Options       <- quiz / weather-handoff / news-roundup placement
                         (grammar not yet defined)
```

This is about the *input* brief format, which is new and still being worked
out. It's separate from `script-format.md`, which specifies the `.script.md`
*output* grammar a future director will consume — that document is still
current and unaffected by this redesign.
