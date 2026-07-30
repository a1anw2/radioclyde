# sample-data

An example `dataDir` (see `config.json` → `dataDir` and the main
[README](../README.md)) — a working `station.json` and a full set of
`show-descriptions/*.md` briefs, so you can see the shape of a real station
without having to write one from scratch.

To try it: point `dataDir` in your `config.json` at a writable copy of this
folder (don't point it at this folder in-place — the app writes generated
scripts, logs, playlists, and other runtime output into `dataDir`).

The `station.jingle` path (`jingles/on_air.mp3`) is illustrative only; no
audio file is included. Jingles are optional — if the file isn't found, it's
skipped.
