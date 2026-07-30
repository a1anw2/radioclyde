# Adding a new DJ persona

A "DJ" is just a `config.json` `personas` entry (a voice + a system prompt)
plus a couple of optional cosmetic assets. There's no code to write or
build step to run -- every place that reads personas keys off
`config.personas` at runtime, so a new entry is picked up immediately on the
next scheduler restart.

## 1. Get the reference voice clip onto the Chatterbox server

Chatterbox does the actual voice cloning from a reference `.wav`, and it
does so entirely on its own side -- **this repo never touches that file**.
`config.json`'s `voiceFile` is sent to Chatterbox as an opaque
`predefined_voice_id` string (`src/director/tts.js`'s `requestSynthesis`);
nothing here reads, uploads, or resolves it against a local path.

So before anything in this repo can use a new voice, the reference clip has
to already exist in Chatterbox's own voice library, under whatever filename
you're about to reference. That's entirely a Chatterbox-server-side step
(its own UI/API/filesystem), outside this codebase.

A clean reference clip matters more than any generation parameter: since
Chatterbox clones the reference recording's own acoustic character, a
bassy, close-mic'd, or noisy source clip comes through in every line that
persona ever speaks, and no `cfg_weight`/`exaggeration` tuning
(`config.chatterbox`, see `tts.js`) fixes that after the fact.

## 2. Pick a persona id

Lowercase, single word, `^[a-z0-9_-]+$` (this exact pattern is enforced by
`src/server/djPhotoProxy.js` for the photo route, and matches every existing
key in `config.json`'s `personas`). e.g. `marcus`.

## 3. Add the persona to `config.json`

```json
"personas": {
  "marcus": {
    "voiceFile": "Marcus.wav",
    "systemPrompt": "You are Marcus, a ..."
  }
}
```

- `voiceFile` -- must exactly match the filename Chatterbox already knows
  (step 1).
- `systemPrompt` -- short persona description, same shape as every other
  entry. Used as the DJ's writing-voice instruction wherever this persona's
  lines get drafted (`src/producer/moves.js`, `src/director/liveSegments.js`
  for live weather/time call-ins).

This is the only edit required for the persona to *exist*. `config.example.json`
should get the same entry (with a placeholder `voiceFile`) so the example
stays a truthful template, but only `config.json` is actually loaded at
runtime.

## 4. Optional: photo

Drop `<persona-id>.jpg` into `public/dj-photos/` (e.g. `marcus.jpg`) and add
a cell to the "Meet the DJs" table in `README.md`. Not required --
`djPhotoProxy.js` 404s gracefully on a missing photo and the web/Android
clients already treat that as "no artwork" with no special handling.

## 5. Give the persona a show

None of the above puts the persona on air by itself -- a show only speaks
in a given persona's voice if its brief says so. In
`radiodata/show-descriptions/<show>.md`:

```
**Personas:** marcus, elena
```

First name listed is the primary host (drives open/close/intro/recap/quiz
per `src/producer/showBrief.js`); any further names are available for
special segments like the weather desk. A show can only use personas
listed on this line.

## Gotchas

- **Typo'd or unknown persona names don't fail loudly where you'd expect.**
  `src/script/format.js`'s `parseScript` flags an unrecognized `persona:` as
  a warning, not a blocking error (`src/producer/generateScript.js` still
  writes `script.md` to disk either way) -- the mistake instead surfaces
  later, as a hard throw from `src/director/djAudio.js` ("Unknown persona
  ... no voiceFile in config.js") when directing tries to synthesize that
  segment. Double-check the id matches `config.json` exactly before a show
  airs on it, don't rely on script generation to catch it.
- **No dry-run tool exists yet for "just synthesize one line and listen."**
  The closest thing is `node src/cli/prewarmShowAudio.js --id=<showId>`,
  which synthesizes every not-yet-cached `dj` segment of an already-produced
  show -- useful to warm the cache for a real show, but it needs a real
  script.md to exist first. For a quick smoke test of a brand new voice
  before wiring it into any show, the fastest path is a throwaway one-off:
  ```js
  import { synthesizeVoice } from './src/director/tts.js';
  import fs from 'node:fs';
  fs.writeFileSync('/tmp/test.wav', await synthesizeVoice('Hello, this is a test.', 'Marcus.wav'));
  ```
- **`config.chatterbox`'s `exaggeration`/`cfgWeight`/`temperature` are
  global, not per-persona** -- they tune every voice's generation the same
  way. If one new voice needs different tuning than the rest, that's not
  currently supported and would need `tts.js`/`djAudio.js` changed to accept
  a per-persona override.
