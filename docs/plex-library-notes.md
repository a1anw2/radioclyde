# Plex Library Notes

Empirical facts about the actual Plex Media Server backing this station
(library section id from `config.json`), confirmed live against the real
server — not assumptions from Plex's general documentation. Useful
regardless of which show is being built.

## Artist search

- `title=` on **artist** objects (type=8) is an **exact** match, not
  substring — confirmed live: `title=Fleetwood` against a library with no
  artist named "Fleetwood" returns zero results; it does *not*
  fuzzy-match "Fleetwood Mac".
- `title=` on **track** objects (type=10) *does* do substring matching
  (e.g. searching "Queen" also matches "Christine and the Queens").
- Because artist matching isn't fuzzy at the API level, resolving an
  artist name requires fetching the full artist list (cheap — a few
  hundred to a few thousand at most) and doing a substring/exact match
  pass client-side, rather than relying on the API's own `title=` filter.
- This library has **517 artists** (as of 2026-07-26).

## Genre tags

This library's full genre tag set for tracks (fixed, coarse):

> Avant-Garde, Blues, Children's, Classical, Comedy/Spoken, Country, Easy
> Listening, Electronic, Folk, Holiday, International, Jazz, Latin, New
> Age, Pop/Rock, R&B, Rap, Reggae, Religious, Stage & Screen, Vocal

- There is **no** "Rock", "Classic Rock", or other finer-grained rock tag —
  all rock-adjacent music is lumped under **"Pop/Rock"**.
- Genre tagging is **unreliable for thematic exclusion** (e.g. "no
  Christmas songs"). Confirmed live: Christmas tracks in this library are
  inconsistently tagged (some `genre: []`, some `genre: ["Pop/Rock"]`, none
  actually tagged "Holiday" in the sample checked), and one song ("Santa
  Claus Is Back in Town", Elvis Presley) isn't even on an album with
  "Christmas" in its name. Keyword matching against title + album + genre
  text together is the only thing that reliably catches this.

## Popularity signal

- Plex's music metadata agent attaches a `ratingCount` field to tracks — a
  real **global** popularity figure, not a personal/local play count
  (that's `viewCount`, which is tiny here — e.g. 1-3, reflecting only this
  library owner's own plays in Plex).
- Confirmed live examples (Elvis Presley): "Hound Dog" `ratingCount =
  875,729`, "Heartbreak Hotel" `ratingCount = 632,902` (well-known hits)
  vs. deep cuts in the low hundreds to low thousands.
- Not present on every track — some show `null`.

## Specific artists/content (as of 2026-07-26)

- **Fleetwood Mac**: not in this library at all.
- **Queen**: present, 354 tracks.
- **Elvis Presley**: present, 1,719 tracks — spans studio albums, movie
  soundtracks, gospel recordings, live albums, and heavy compilation
  overlap (e.g. "Jailhouse Rock" appears under at least two different
  catalog entries/albums).

## Data quality gaps observed (not fixed, just noted)

- Some tracks have truncated/corrupted title tags — e.g. one Elvis track's
  title is literally `"Just Call Me Lonesome (Alterna"` with incomplete
  album/year fields too. A tagging issue in the source library itself, not
  something the pipeline tries to correct.
- Some file/title mismatches exist — e.g. a track titled "Blue Suede Shoes"
  whose underlying file path is literally named `Return to sender.mp3`.
  Again a library data-quality issue, not a pipeline bug.
