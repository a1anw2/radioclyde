# Documentation

Design rationale and hard-won empirical facts for the radiocylde show-producer
pipeline redesign (started 2026-07-26), kept here so a future session doesn't
have to re-derive them from scratch.

- [producer-pipeline.md](producer-pipeline.md) — architecture of the new
  track-selection + research pipeline: what each stage does, why it's built
  the way it is, and what's still open/not yet built.
- [plex-library-notes.md](plex-library-notes.md) — empirical facts about this
  specific Plex library and its API behavior, confirmed live against the
  real server (not assumptions from Plex's general documentation).
- [android-tv-app.md](android-tv-app.md) — architecture of the native
  Android TV/Google TV client (`android-tv/`, a separate Gradle project in
  this repo): package layout, the backend API it consumes, key design
  decisions, and gotchas already hit (don't reintroduce them).

Related docs at the repo root (not moved here):
- [`../README.md`](../README.md) — project overview, setup, and the npm
  scripts reference (pipeline + preview/dry-run tools).
- `plan.md` — the original infrastructure build plan (Icecast/Liquidsoap/LM
  Studio/Chatterbox wiring). Mostly historical at this point.
- `script-format.md` — the `.script.md` *output* grammar a future "director"
  will mechanically consume to produce broadcast assets. Still current.
- `show-descriptions/*.md` — older, loosely-specified prose show briefs.
  Being superseded by the new structured Track Selection format described in
  `producer-pipeline.md`.
