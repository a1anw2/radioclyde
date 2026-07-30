# radio.liq — Liquidsoap playout engine
# Reads shared settings from config.json (see plan.md "Configuration").
#
# Scheduled-show playout: fully pre-produced episodes only. No live
# generation happens here anymore -- scheduler/scheduler.js (systemd) is the
# sole writer of now_playing.m3u, and does so purely by checking wall-clock
# time against station.json's schedule plus which occurrences have been directed.
# When no show is in its scheduled window, or the scheduled show isn't
# directed yet, now_playing.m3u is left as-is (possibly empty) and this
# station falls back to a shuffled library playlist (filler.m3u) rather than
# going silent -- silence disconnects Icecast/Sonos clients. See
# conversation with Alan, 2026-07-27 (reversing the prior "goes silent"
# decision from 2026-07-26).

let json.parse (config : {
  dataDir: string,
  icecast: {sourceHost: string, port: int, mount: string, sourcePassword: string, bitrate: int}
}) = file.contents("/home/ai/radioclyde/config.json")

# mode="normal" plays the file's entries in order (this is a produced show,
# not a shuffle playlist). loop=false: once an episode's segments are
# exhausted, stay empty for whatever remains of the scheduled window rather
# than restarting the episode from the top -- fallback() below then takes
# over. reload_mode="watch" picks up scheduler/scheduler.js's edits without a restart.
show_source = playlist(reload_mode="watch", mode="normal", loop=false, config.dataDir ^ "/now_playing.m3u")

# Tried crossfade() here (asymmetric fade_in=3.5/fade_out=1.0/duration=3.5,
# tuned via offline RMS-envelope testing against real DJ-audio + track
# assets) to soften the hard digital cut at every dj<->track boundary. Still
# audibly cut the DJ off live, 2026-07-28, even after that tuning pass --
# reverted to a plain hard cut rather than continuing to chase the params.
# If revisiting this, don't just re-tune crossfade()'s numbers again; the
# 2026-07-27/07-28 history (see git log on this file) is two rounds of that
# already.
#
# fade.in (below) is a different mechanism, not a re-tuned crossfade() --
# crossfade() overlapped two adjacent sources (that overlap is what clipped
# the DJ), while fade.in just shapes one track's own amplitude envelope in
# place, no overlap with its neighbour. Per-entry duration comes from each
# playlist entry's own liq_fade_in annotate metadata (director/playlist.js)
# -- tracks fade up, DJ speech gets explicit "0" (a hard cut, not a skip) so
# it's never faded (listener feedback, 2026-07-29). duration=0. here is the
# fallback for any entry that somehow arrives unannotated.
#
# Deliberately NOT wrapped in fade.out() too, unlike fade.in -- confirmed
# live 2026-07-29 that fade.out() at low (<~0.5s) durations doesn't no-op,
# it silences the *entire* track, not just the tail, in this Liquidsoap
# build (2.2.4-1+dev). A global fade.out(duration=0., ...) here silenced
# every entry without its own large override, i.e. everything except the
# jingle -- the whole station went silent. The jingle's fade-down is instead
# baked into a rendered copy of the file at production time (director/
# index.js, lib/audio.js's applyFadeOut), so no runtime fade.out() is needed
# at all. Do not re-add fade.out() here without re-verifying that bug is
# actually fixed upstream first.
show_source = fade.in(duration=0., show_source)

# Off-air filler: a big shuffled pool from the whole music library
# (scheduler/generateFillerPlaylist.js, regenerated periodically by scheduler/scheduler.js),
# no DJ talk. mode="randomize" so it doesn't play the same order every time
# it loops back around. Same fade-up-only annotate as show_source's tracks.
filler_source = playlist(reload_mode="watch", mode="randomize", config.dataDir ^ "/filler.m3u")
filler_source = fade.in(duration=0., filler_source)

# fallback() plays show_source whenever it has queued content and drops to
# filler_source the instant it's empty/exhausted -- this is what makes a
# scheduling gap (or a show that isn't directed yet) fall back to music
# instead of silence. mksafe stays as the last-resort safety net in case
# filler_source is itself briefly empty (e.g. mid-regeneration).
radio = mksafe(fallback(track_sensitive=false, [show_source, filler_source]))

# Plex scrobble: Plex never sees these plays otherwise -- playback here reads
# straight off the filesystem, bypassing Plex entirely -- so this pings its
# scrobble endpoint on every track boundary to keep view counts/history in
# sync with what's actually broadcast. Fires optimistically at track start,
# not on completion (see conversation with Alan, 2026-07-27).
#
# Deliberately on_metadata, not on_track: fires on every new file's metadata
# regardless of whether a track mark accompanied it, so it's not sensitive to
# how any given source graph handles track marks at a transition -- one
# fewer thing to break if show_source's fade handling changes again.
#
# on_metadata handlers run in the main streaming thread and must stay fast,
# so the actual work happens in thread.run(fast=false, ...); process.run's
# command is itself backgrounded (trailing "&") so even that call returns as
# soon as the shell has forked plex/scrobbleTrack.js, not waiting on the Plex
# HTTP call. plex/scrobbleTrack.js resolves "filename" -- Liquidsoap's own
# resolved path for whatever it's actually decoding -- against dataDir's
# track_ratingkeys.json side index (written by director/index.js/
# scheduler/generateFillerPlaylist.js); DJ speech clips aren't in that index.
# Deliberately NOT "initial_uri": that's the raw playlist line as written,
# so once director/playlist.js started wrapping tracks in annotate:liq_fade_in=...,
# initial_uri became "annotate:liq_fade_in=...:/path" instead of a bare
# path, silently breaking every track's ratingKeyIndex lookup (confirmed
# live 2026-07-29 -- scrobbling, aired-history, and the web now-playing
# display all quietly stopped updating). "filename" is unaffected by
# annotate: wrapping either way -- confirmed live it resolves to the real
# decoded file path for both plain and annotate:-wrapped entries.
# `dj` is director/playlist.js's annotate: field naming who's speaking on a
# speech clip (empty string for track entries and the jingle, which have no
# such field) -- passed through so scrobbleTrack.js can tell "DJ talking"
# apart from a genuinely unknown path instead of treating both as skips.
def scrobble_on_metadata(m) =
  p = m["filename"]
  dj = m["dj"]
  if p != "" then
    thread.run(fast=false, fun () ->
      ignore(process.run("node /home/ai/radioclyde/src/plex/scrobbleTrack.js " ^ process.quote(p) ^ " " ^ process.quote(dj) ^
        " > /dev/null 2>&1 &"))
    )
  end
end
radio = source.on_metadata(radio, scrobble_on_metadata)

output.icecast(%mp3(bitrate=config.icecast.bitrate),
  host = config.icecast.sourceHost, port = config.icecast.port,
  password = config.icecast.sourcePassword,
  mount = config.icecast.mount,
  radio)
