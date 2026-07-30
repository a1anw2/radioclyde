# Show Script Format

Rules for authoring a `.script.md` file — the deliverable of a **producer** session. A
**director** consumes this file mechanically to turn it into a broadcast-ready show: it
does not make creative decisions, pick tracks, write DJ lines, or research facts.
Everything is already decided by the time this file is finished, with one exception —
live weather/time segments — see `type: live` below.

## File structure

```
# 📻 <show title>

**Duration:** <30 | 60> min

---

## <segment 1>
...

## <segment 2>
...
```

- Title (`#`) and `**Duration:**` are required. Duration must be 30 or 60 minutes.
- Segments are ordered top to bottom — that ordering *is* the running order, exactly as
  it will air. There is no separate scheduling/sequencing metadata.

## Segment grammar

Every segment is a `##` heading, then a small block of `key: value` fields (one per
line), then — for `dj` segments only — free body text.

```
## <Human label — free text, for readers only>
type: dj | track | live
persona: <persona key>          (required for dj, live)
...type-specific fields...

<body text — dj only>
```

Rules:
- `type:` is **required** and must be the first field. It is the *only* thing the
  director uses to decide behavior — the heading text is for human readers and can say
  anything (it is never parsed).
- Fields are read until the first blank line; everything after that blank line is body
  text, used only when `type: dj`.
- `persona:` must exactly match a key under `personas` in `config.json`.

### `type: dj`

A fully-authored, literal line (or a few short paragraphs) spoken by one persona. This
is the workhorse type — DJ banter, news roundups, quiz questions *and* answers, intros,
outros, and handoffs between personas are all just this.

```
## DJ — Ryan
type: dj
persona: ryan

Alright everyone, kicking off Friday drivetime!
```

The director does nothing but synthesize this text verbatim in `ryan`'s voice. Write it
exactly as it should be spoken — no stage directions, no meta-commentary.

Chatterbox-Turbo (the TTS engine this station runs) understands a handful of inline
paralinguistic tags and renders them as the actual sound rather than speaking the word:
`[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, `[cough]`, `[clear throat]`, `[sniff]`,
`[groan]`, `[shush]`. Sparingly, e.g. `Honestly [chuckle] I still don't get that lyric.`
Use at most one per line, and only where a real DJ would actually make that sound —
most lines should have none.

### `type: track`

One specific, already-chosen song. Put no commentary here — write DJ lines around it as
separate `dj` segments before/after.

```
## Track
type: track
artist: Fleetwood Mac
title: Don't Stop
ratingKey: 12345
```

`ratingKey` (the Plex library ID) is required, not optional — it's what lets the
director resolve the exact file with zero ambiguity, instead of re-searching Plex by
name at production time.

### `type: live`

The only segment the director doesn't just play back verbatim. Used for anything that
would be stale if written ahead of air — currently: current time and/or current
weather. At production time the director fetches real data and generates the actual
line, using `brief` as tone/length direction — nothing here is spoken as literally
written.

```
## Weather Check — Elena
type: live
persona: elena
kind: time | weather | time-weather
brief: <free text: tone, length, angle — direction, not content>
```

- `kind: time` — current local time only. No network call; sourced from the server
  clock against `config.json` → `weather.timezone`.
- `kind: weather` — current conditions for the station's fixed location
  (`config.json` → `weather.latitude`/`longitude`), via Open-Meteo.
- `kind: time-weather` — both, in one line.
- `brief` is *instruction*, not content — write it like direction to a DJ, not like the
  line itself. Good: `"20s casual check-in, drivetime energy"`. Bad: `"It's sunny and
  75 degrees"` (you don't know that yet — that's the director's job).

## Rules of thumb when authoring

- **Resolve everything you can right now.** Pick real tracks (with `ratingKey`), write
  real DJ lines, write the actual news items and quiz Q&A. If it's knowable at
  authoring time, it does not belong in a `live` segment — `live` is reserved for data
  that would go stale between now and air time.
- **Multi-DJ shows are just multiple `persona:` values** used across `dj`/`live`
  segments in the order they should speak. There is no separate multi-DJ mechanism —
  the segment ordering *is* the conversation.
- **A handoff is an ordinary `dj` segment, not automatic.** If a `live` segment is a
  handoff between personas ("let's check in with Elena..."), write that toss yourself
  as a preceding `dj` segment — the director will not infer it.
- **A quiz is just three segments**: a `dj` segment with the question, a `track`
  segment (the song being guessed, or the next song while listeners think), and a `dj`
  segment with the reveal. No dedicated quiz type is needed.
