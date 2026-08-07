---
description: Coding standards and folder conventions for this project's Node.js source
paths:
  - "src/**/*.js"
  - "package.json"
---

# Node.js Development Rules

These describe how this codebase actually works, not a generic template —
keep them in sync with reality if the conventions below ever change.

## 1. Runtime & module system

- **Runtime**: Node.js (see `package.json`'s `engines` field for the floor).
- **Language**: plain JavaScript. No TypeScript, no build step — `node`
  runs these files directly.
- **Module system**: pure ESM. Always `import`/`export`, never
  `require`/`module.exports`.
- **Imports**: always include the `.js` extension on relative imports
  (`import { config } from '../config/index.js'`).
- **Exports**: named exports only, everywhere. No `export default` — this
  keeps every import site self-documenting about what it's actually pulling
  in, and avoids the "what do I call this on import" ambiguity default
  exports create.
- **Variables**: `const` by default; `let` only when a binding is genuinely
  reassigned. No `var`.

## 2. Error handling (as actually practiced here)

- Let errors throw with a specific, descriptive message (what failed, what
  the real inputs were) — most functions have no `try/catch` at all, and
  that's correct: a thrown error from three layers down with a good message
  is more useful than a swallowed one.
- Only catch where you can actually do something with the failure: retry
  (`lib/lock.js`'s stale-lock recovery, `producer/research/wikipedia.js`'s
  429 backoff), a fallback value (`director/index.js` falling back to
  Plex-metadata facts when Wikipedia research fails), or a final log.
- Every CLI entrypoint (a file with a `main()` guarded by
  `if (import.meta.url === \`file://${process.argv[1]}\`)`) has exactly one
  top-level `main().catch((err) => { log(...); process.exitCode = 1; })`.
  Nothing further up needs its own catch.
- Don't add speculative `try/catch` around code whose failure modes you
  haven't identified — an empty or generic catch block hides real bugs.

## 3. File & function size

- Soft cap: **~150–200 lines per file**, **~30–40 lines per function**. One
  clear responsibility per file.
- **Named exception**: a pipeline's single orchestrator file
  (`producer/generateScript.js`, `director/index.js`, `scheduler/scheduler.js`)
  is allowed to run longer. Its length reflects a linear sequence of phases
  it coordinates, not mixed concerns — don't split it just to hit the line
  count; split out a *phase* only when that phase is independently reusable
  or independently testable.
- When a file mixes two genuinely different jobs (e.g. "fetch data" +
  "format a Liquidsoap playlist line"), that's the actual signal to split —
  not line count on its own.

## 4. Folder map

```
src/
  config/     one file (index.js) — loads config.json, derives every
              operational path from dataDir. No domain knowledge; everything
              else imports from here.
  lib/        generic, zero-domain-knowledge helpers (logging, arg parsing,
              time formatting, locking, bounded concurrency, ffmpeg wrappers).
              A function belongs here if it would make sense in a totally
              unrelated project with no changes.
  llm/        the LM Studio chat-completions client and shared DJ-prompt
              instruction strings. No knowledge of shows/tracks/schedule.
  plex/       all Plex HTTP access (tracks, albums, artists, genres,
              scrobbling), plus track-list filtering/weighting and the
              path/ratingKey sidecar index.
  script/     the `.script.md` grammar (parse/render) — shared by producer
              and director, since director/index.js parses what
              producer/generateScript.js wrote.
  producer/   the show-producer pipeline: brief parsing, AI track-query
              step, deterministic track-queue building, Wikipedia research,
              the boundary walk + move vocabulary, final cross-segment
              review, and the top-level orchestrator.
  director/   turns a finished script.md into broadcast assets: TTS
              synthesis, live weather/time segment resolution, Liquidsoap
              playlist/annotation formatting, and the top-level orchestrator.
  scheduler/  the long-running daemon and its per-tick jobs (schedule
              math, station.json change detection, script/direct triggers,
              now-playing, filler regeneration, cleanup).
  cli/        manual dry-run tools invoked directly by a developer, not by
              the scheduler daemon.
```

`liquidsoap/radio.liq` lives outside `src/` entirely — it's Liquidsoap, not
JavaScript, and these rules don't apply to it.

- **No barrel files.** Don't add an `index.js` that just re-exports a whole
  folder's contents — import from the specific submodule that defines what
  you need. The one exception is a domain's single orchestrator entrypoint
  (`director/index.js`), which is a real module with real logic, not a
  re-export shim.
- `config/`, `lib/`, `llm/`, `plex/`, and `script/` never import from
  `producer/`, `director/`, `scheduler/`, or `cli/` — that dependency only
  ever flows one way. This is what will let a future `src/server/` (Fastify)
  safely import any of those five without circular-dependency risk.
- Filenames are camelCase (`scheduleUtil.js`, `ratingKeyIndex.js`). No
  snake_case.

## 5. Logging

Use `lib/logger.js`'s `createLogger(name)`, writing to
`<dataDir>/logs/<name>.log`. There are exactly two names in use: `'station'`
for everything under the scheduler daemon (producer, director, plex,
scheduler jobs, CLI tools) and `'web'` for `src/server/`. Don't reach for a
new logging approach or a third logger name — these two map onto the two
systemd services (`radioclyde-scheduler`, `radioclyde-web`), which is the
granularity that matters for reading/rotating logs.

`logsDir` files rotate automatically: once `<name>.log` passes 10MB it's
renamed to `<name>.log.1` (overwriting any previous one), so each logger
never keeps more than one backup behind its active file.
