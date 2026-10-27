# Wadsworth help

> Read-only. Seeded by the harness; edit the template in the Wadsworth repo, not this file.

This folder (`.wadsworth/`) is the workspace policy for the Wadsworth harness. Secrets and provider keys live in the harness `runtime/wadsworth.json`, not here.

## Layout

| Path | Role |
|------|------|
| `config.json` | Models, MCP servers, channels, default tools (no API keys) |
| `*.png` / `*.svg` / … | Optional workspace icon file (path in `config.json` `icon`) |
| `AGENT.md` | Project brief shown every turn (or use root `AGENTS.md` / `CLAUDE.md`) |
| `skills/` | Workspace skills (`SKILL.md`); also the unit a `newTask` subagent can run |
| `scripts/` | Named packs run via `script_call` |
| `tasks/` | Subagent task transcripts (gitignored; Inbox). Fan-out batches also store a manifest under `tasks/_batches/`. |
| `sessions/` | Chat transcripts (gitignored) |
| `file-history/` | Save snapshots for `.md` / `.txt` / `.csv` before overwrite (gitignored; open from the editor status bar) |

Durable facts use the `memory` tool (`remember` / `search` / `forget`) and code RAG — there is no `MEMORY.md`.

`config.json` `mode` is `coding` or `general` (workspace default). Session `/mode` can differ. Optional `icon` is a path relative to this folder (for example `avatar.png`) for the web UI. With `rag.enabled`, coding sessions may attach automatic code snippets from the harness Lance index (under harness `runtime/rag/`, not in this folder). Treat snippets as hints; use `read` before `edit`.

## Chat

- `/` commands run in the engine (`/help`, `/tools`, `/mcp`, `/status`, `/reload`, …).
- `@path` attaches a workspace file to the next turn.
- Skills attach their `SKILL.md` body and go to the model. A skill's `allowed-tools` **adds** those tools for the rest of that run (within what the workspace may use).

After you edit `config.json`, run `/reload` (or reopen the session).

## Built-in tools

The model calls these by name (see `/tools` in chat for what this session advertises, including MCP). **Core** tools are always on for interactive sessions unless a skill `allowed-tools` list narrows a worker. **Optional** tools must be listed in workspace `config.json` `tools.optional` and turned on (`tools.defaultEnabled` and/or `/tool on <name>`). **MCP** tools use `mcp__<serverId>__<toolName>` (see [MCP tools](#mcp-tools-two-naming-forms) below). The `now` tool is always available and cannot be turned off.

| Tier | Tools |
|------|--------|
| Always | `now` |
| Core | `ls`, `find`, `mkdir`, `read`, `write`, `edit`, `rm`, `memory`, `skill`, `newTask`, `scheduleTask`, `script_call`, `slack_send`, `whatsapp_send` |
| Optional | `grep`, `web_fetch`, `feeds`, `text_image` |

Paths are workspace-relative unless noted. Writes and deletes on existing files usually ask for approval unless the session has auto-approve. There is no shell tool.

### `now` (always)

Current date and time. Uses the workspace `timezone` from `config.json` unless you pass another IANA zone.

| Parameter | Type | Description |
|-----------|------|-------------|
| `timezone` | string, optional | IANA name (e.g. `America/New_York`). Omit for the workspace default. |

### Core file and search tools

**`ls`** — List a folder or describe one file (also checks existence).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | `.` | Folder to list or file to describe. |
| `recursive` | boolean | `false` | Walk subfolders (capped); ignored for a file path. |
| `limit` | integer | `100` | Max entries when `recursive` is true (1–500). |

**`find`** — Find files or folders by glob below a folder.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pattern` | string | required | Glob (`*.md`, `**/foo`, `2026/*.txt`, etc.). |
| `path` | string | `.` | Folder to search under. |
| `type` | `file` \| `dir` | — | Restrict to files or directories. |
| `limit` | integer | `100` | Max matches (1–500). |

**`mkdir`** — Create a directory (parents created by default).

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Directory to create. |
| `recursive` | boolean, optional | Create parents (default true). |

**`read`** — Read a text file; result includes `lineStart`, `lineEnd`, `totalLines`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | File to read. |
| `line` | integer, optional | Read exactly this 1-based line (do not combine with `offset`/`limit`). |
| `offset` | integer, optional | 1-based start line; without `limit`, reads through end of file. |
| `limit` | integer, optional | Max lines after `offset`. |

**`write`** — Create or replace a file (`append: true` adds to the end). Max **16 000** characters of `content` per call; chunk large files with `append`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Output path (put before `content` in JSON). |
| `content` | string | File body. |
| `append` | boolean, optional | Append instead of replace. |

**`edit`** — Replace one unique `old_string` with `new_string`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | File to edit. |
| `old_string` | string | Exact text to find (once). |
| `new_string` | string | Replacement. |
| `start_line` | integer, optional | Limit search to this line range (1-based). |
| `end_line` | integer, optional | Last line of range (defaults to `start_line`). |

**`rm`** — Delete a file or directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Target path. |
| `recursive` | boolean, optional | Required to remove a directory. |

### `memory` (core)

Long-term vector memory for this workspace (`memory.enabled` in `config.json`). Relevant memories may also be injected automatically on turns.

| Parameter | Type | When | Description |
|-----------|------|------|-------------|
| `action` | `remember` \| `search` \| `forget` | always | What to do. |
| `content` | string | `remember` | One durable fact. |
| `kind` | `fact` \| `preference` \| `decision` \| `person` \| `project` | `remember`, optional | Category. |
| `supersedes` | string | `remember`, optional | Id of a memory this replaces. |
| `query` | string | `search` | Plain-language search. |
| `limit` | integer | `search`, optional | Max hits (default 5, max 10). |
| `id` | string | `forget` | Memory id from a search result. |

### `skill` (core)

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string, optional | Omit to list skills. Pass slug/name to load that skill’s instructions for the rest of the run. |

### `newTask` (core)

Enqueue background workers (Inbox). Returns task ids immediately. At most **20** jobs per `tasks` array. Larger fan-out uses the same **`batchId`** across several calls; the harness tracks the batch under `.wadsworth/tasks/_batches/` and only runs **`onComplete`** after every stamped job in that batch finishes (including jobs from later chunks and from workers that inherit the batch).

| Parameter | Type | Description |
|-----------|------|-------------|
| `skill` | string, optional | Skill slug for a lean worker; omit for a raw-prompt worker with workspace default tools. |
| `prompt` | string, optional | Single job text (use `tasks` for a batch). |
| `model` | string, optional | Model id (workspace-enabled); else skill `metadata.model` or session model. |
| `skipIfExists` | string, optional | Workspace path; skip job if that file already exists. |
| `mutex` | string, optional | Lock key (often a path); one task per mutex at a time. |
| `tasks` | array | Up to 20 jobs: each `{ prompt, skill?, model?, skipIfExists?, mutex? }`. Starting a `tasks` batch allocates a `batchId` (returned in the tool result). |
| `batchId` | string, optional | Fan-out label for this prompt (any string; stored under a hashed internal id). The tool result echoes **the same** `batchId` you passed. Reuse that label on every chunk. Within one prompt, the active batch is also reused without re-passing `batchId`. |
| `onComplete` | object, optional | After **all** jobs sharing the batch `batchId` succeed: `{ prompt, skill?, model? }`. Set **once** per batch (usually on the last chunk). Omit `skill` to continue in this chat. |

### `scheduleTask` (core)

Queue a lean Inbox worker for later. Does **not** hold this chat. Pass exactly one of `at` or `cron`. Cancel the pending Inbox row to stop a series.

| Parameter | Type | Description |
|-----------|------|-------------|
| `skill` | string, optional | Skill slug for a lean worker; omit for a raw-prompt worker. |
| `prompt` | string | The task to run when the schedule fires. |
| `at` | string, optional | One-shot time: offset ISO, or naive `YYYY-MM-DDTHH:mm` in the workspace timezone. Call `now` first. Must be in the future. |
| `cron` | string, optional | Five-field expression (`minute hour day month weekday`) in the workspace timezone. Each fire is a new Inbox task. |
| `model` | string, optional | Model id (workspace-enabled); else skill `metadata.model` or session model. |
| `skipIfExists` | string, optional | Workspace path; skip creating the job if that file already exists. Prefer a dated path on cron schedules. |
| `mutex` | string, optional | Lock key (often a path); one task per mutex at a time. |

### `script_call` (core)

Run a pack under `.wadsworth/scripts/<name>/` (JSON args on stdin).

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string, optional | Omit to list scripts. |
| `args` | object, optional | JSON object passed to the script stdin. |

### `slack_send` and `whatsapp_send` (core)

Post to the owner’s linked channel when that channel is enabled and connected. Usually asks for approval unless auto-approve is on.

**`slack_send`**

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string | Message for the workspace’s configured Slack channel. |

**`whatsapp_send`**

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string, optional | Message text, or **caption** when `imagePath` is set. |
| `imagePath` | string, optional | Workspace path to JPEG/PNG/WebP/GIF. One of `text` or `imagePath` is required. |

### Optional tools

Turn on in **Workspace Settings → Tools** or `/tool on <name>`.

**`grep`** — Regex search in files (uses `rg` when installed).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pattern` | string | required | Regular expression. |
| `path` | string | `.` | File or folder to search. |

**`web_fetch`** — GET an `http` or `https` URL; returns stripped text plus capped links. Images may return vision parts for one hop. Fetched text is untrusted.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Absolute URL. |

**`feeds`** — Search or load indexed feed stories (`channels.feeds.enabled`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | `search` \| `get` \| `topics` | `search` needs `query`; `get` needs `articleKey`; `topics` lists clustered headlines. |
| `query` | string | Search words (`search`). |
| `articleKey` | string | Story id (`get`). |
| `feedId` | string, optional | Narrow to one feed. |
| `categoryId` | string, optional | Narrow topics/search to one RSS category. |
| `timeRange` | `today` \| `week` \| `month` \| `all`, optional | Window for `topics` (default `week`). |
| `limit` | integer, optional | Max hits (`search` default 5, max 10; `topics` default 10, max 15). |
| `fetchPage` | boolean, optional | On `get`, also fetch the article link like `web_fetch`. |

**`text_image`** — Render centered text into a JPEG in the workspace.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Output path ending in `.jpg` or `.jpeg`. |
| `text` | string | Body text (line breaks preserved). |
| `width` | integer, optional | Canvas width px (default 1200). |
| `height` | integer, optional | Canvas height px (default 630). |
| `backgroundColor` | string, optional | e.g. `#ffffff`. |
| `foregroundColor` | string, optional | Text color. |
| `backgroundImage` | string, optional | Workspace image path (cover). |
| `padding` | integer, optional | Margin px (default 48). |

## Constructing a skill

Skills follow the [Agent Skills](https://agentskills.io/specification) shape: one folder per skill with a `SKILL.md` file. Wadsworth loads them from `.wadsworth/skills/` (primary), and also `.cursor/skills`, `.agents/skills`, `.claude/skills`, and `.claude/commands` when present. The **folder name** is the `/slug` in chat unless frontmatter `name` differs.

### Folder layout

```
.wadsworth/skills/<slug>/
  SKILL.md          required — YAML frontmatter + markdown body
  scripts/          optional — helper files the model reads with `read` (not executed)
  references/       optional — docs, templates, examples
  assets/           optional — images or other files referenced in the body
```

Install packs from **Settings → Skills**, or copy a folder in by hand. Relative paths in the skill body resolve to this directory.

### `SKILL.md` structure

1. Opening `---` line.
2. **YAML frontmatter** (keys below).
3. Closing `---` line.
4. **Markdown body** — instructions shown when the skill is invoked (`/slug`, the `skill` tool, or a `newTask` worker brief).

`description` is **required**. Other fields are optional. Unknown frontmatter keys are ignored with a discovery warning. Tool lists may use `allowed-tools`, `allowed_tools`, or `tools` (same meaning; `allowed-tools` wins if several are set).

### Frontmatter fields Wadsworth supports

| Field | Required | Purpose |
|-------|----------|---------|
| `description` | yes | One line the model uses to decide when to invoke the skill (max 1024 characters). Shown in the `/` palette and skill catalog. |
| `name` | no | Display / lookup name. Defaults to the parent folder name (`slug`). |
| `license` | no | SPDX or short license note (spec). |
| `compatibility` | no | Environment notes (max 500 characters); included when the skill loads. |
| `metadata` | no | Map of string keys to string values. Harness uses **`metadata.model`**: default model id or provider label for `newTask` workers (must resolve to a workspace-enabled model; otherwise the session model is used). Override per call with `newTask`'s `model` argument. |
| `allowed-tools` | no | Space-separated tool ids, or a YAML list of names. See [tool semantics](#skill-allowed-tools) and [MCP naming](#mcp-tools-two-naming-forms) below. |
| `disable-model-invocation` | no | Set to `true` to hide the skill from the model's skill catalog. `/slug` and explicit `skill` tool calls still work. |

Common aliases in `allowed-tools` are mapped to harness tools: `Read` → `read`, `Grep` → `grep`, `Glob` → `find`, `WebFetch` → `web_fetch`, and similar. There is no shell; `Bash(...)` entries are not offered.

### Skill `allowed-tools` semantics {#skill-allowed-tools}

| How the skill runs | `allowed-tools` effect |
|--------------------|-------------------------|
| `/slug` or `skill` tool in chat | **Additive** for that `runPrompt`: session tools ∪ listed tools, within the workspace allowlist. Omit the field to leave session tools unchanged. While the skill is active, `newTask` and `scheduleTask` are offered only if they appear on this list. |
| `newTask` / `scheduleTask` with `skill` | **Hard allowlist** when `allowed-tools` is set (plus the always `now` tool). Omit it to give the worker workspace default tools and MCP. Model and `autoApprove` come from the workspace and origin session (except `metadata.model` / `newTask.model` / `scheduleTask.model`). `maxTurns` uses the same workspace number but a **fresh hop counter per worker** — workers do not spend the parent turn’s hops. |

### Example skill

```markdown
---
name: secretary
description: Read mail-like tasks and write short notes to the workspace.
allowed-tools: skill read write memory newTask
metadata:
  model: claude-sonnet
license: MIT
compatibility: Needs workspace MCP mail tools if you use them in allowed-tools.
---

You are a secretary-style worker.

1. Use only the advertised tools.
2. Write artifacts under the workspace when later steps will need them.
3. Prefer `newTask` for follow-up work instead of one long turn.
```

Save as `.wadsworth/skills/secretary/SKILL.md`, then `/secretary` in chat or `newTask({ skill: "secretary", prompt: "…" })`.

## MCP tools: two naming forms

Register new MCP servers (and OAuth sign-in) under **Settings → Global Settings → MCP**. Every workspace can use any catalog server; the workspace MCP tab picks which servers start **on** for new sessions and can narrow tool allowlists.

**Workspace defaults** (`config.json` `mcp.servers`): servers on when a session starts. Per-server tool subsets use bare tool names under `mcp.tools`.

```json
"mcp": {
  "servers": ["tvmaze"],
  "tools": {
    "tvmaze": ["tvmaze_get_next_episode"]
  }
}
```

Omit a server under `mcp.tools` to offer all of that server's tools. Use `[]` to offer none.

**Skill `allowed-tools` frontmatter**: space-separated names. MCP tools use the namespaced id only.

```yaml
allowed-tools: read mcp__tvmaze__tvmaze_get_next_episode
```

Pattern: `mcp__<serverId>__<toolName>`. Bare MCP names in a skill are dropped.

Where to get `<toolName>`: `/mcp on <serverId>` or `/tools` in a session that has the server enabled.

## Subagents and Inbox tasks

A **subagent** is a task run: lean context (code RAG + vector memory recall + skill/prompt), not a separate folder of agents. Skills live under `.wadsworth/skills/`.

`newTask` queues work **now**. Pass `skill` to run that skill as a lean worker. Optional `allowed-tools` narrows the worker to those tools and matching MCP servers; without it, the worker uses workspace default tools. Omit `skill` for a raw prompt with the same defaults. In a `tasks` batch, each job may set its own `skill`. Set `metadata.model` on the skill (or pass `model` on `newTask`) to pick a model; otherwise it inherits the session model. Transcripts land under `.wadsworth/tasks/<skill|raw>/<id>/`. The Inbox shows `todo` / `scheduled` / `executing` / `completed` / `failed`. Concurrency follows **that task's model provider** `parallel` in harness config.

`scheduleTask` queues the **same** lean worker for later. Pass exactly one of `at` (ISO date/time; call `now` first) or `cron` (five fields, workspace timezone). This chat does **not** wait, and aborting the turn does not cancel the reminder. The Inbox row stays `scheduled` until it fires. Cancel that row to stop a cron series. Retry of a failed run is one extra immediate job and does not keep repeating. This is not a Settings cron: it does not write `config.json`.

When several jobs edit the same file, pass `mutex: "path/to/file.md"` on `newTask` (top-level for a batch, or per job). Only one task with that mutex runs at a time in the workspace.

### `onComplete` and `batchId`

Use `onComplete` when something should run **after** background workers finish. The follow-up does not see worker transcripts — each task should write files and the follow-up prompt should name those paths.

- **Up to 20 jobs in one call:** pass `tasks` and `onComplete` together. Every job gets the same `batchId`; the join runs when they are all done.
- **More than 20 jobs:** queue chunks with `tasks` (≤20 each). Reuse `data.batchId` from the first result on every later chunk. Put `onComplete` **only on the last chunk** (or on the only chunk that sets it once for that `batchId`).
- **Skill follow-up:** `onComplete.skill` runs a lean worker instead of this chat.
- **This chat:** omit `onComplete.skill`; the top-level agent runs `onComplete.prompt` after the batch succeeds.
- **Failures:** if any task in the batch fails, `onComplete` is skipped.
- **Chaining:** a follow-up may queue another batch; handing back to the top-level agent stops after 8 times.

Omit `onComplete.skill` and the top-level agent runs `prompt` in this chat once every job in the batch has finished successfully. Pass `onComplete.skill` and that skill worker runs the follow-up instead. The chat stays open until the follow-up finishes.

**Single call (≤20 jobs) with follow-up in this chat:**

```json
{
  "skill": "secretary",
  "tasks": [
    {
      "prompt": "Read the first thread. Write the summary to out/a.md. Do not call newTask.",
      "skipIfExists": "out/a.md"
    },
    {
      "prompt": "Read the second thread. Write the summary to out/b.md. Do not call newTask.",
      "skipIfExists": "out/b.md"
    }
  ],
  "onComplete": {
    "prompt": "Read out/a.md and out/b.md. Write out/summary.md with one section per file. Do not queue more tasks."
  }
}
```

Add `"skill": "secretary"` inside `onComplete` when a skill worker should do that follow-up instead of this chat.

**Fan-out over 20 jobs (three `newTask` calls, one `onComplete`):**

```json
{ "skill": "secretary", "tasks": [{ "prompt": "Summarize thread 1 to out/01.md" }, …] }
```

→ result echoes `"batchId": "digest-2026-10-24"` (the label you passed). Reuse that string on later chunks.

```json
{
  "skill": "secretary",
  "batchId": "digest-2026-10-24",
  "tasks": [{ "prompt": "Summarize thread 21 to out/21.md" }, …]
}
```

```json
{
  "batchId": "digest-2026-10-24",
  "onComplete": {
    "prompt": "Read every file under out/. Write out/index.md listing them. Do not queue more tasks."
  }
}
```

Do not pass `onComplete` on two chunks with the same `batchId` — the harness accepts it only once per batch.

One-shot later (call `now` first so `at` is in the future):

```json
{
  "skill": "secretary",
  "prompt": "Write tomorrow's digest to out/digest.md.",
  "at": "2026-10-24T09:00:00-04:00"
}
```

Repeating (each fire is a new Inbox task; cancel the pending `scheduled` row to stop):

```json
{
  "prompt": "Check the inbox and write notes/today.md.",
  "cron": "0 8 * * 1-5"
}
```

## Useful commands

| Command | What it does |
|---------|----------------|
| `/tools` | What the model can call, and MCP tool costs |
| `/mcp on\|off <id> [tool…]` | Connect or hide servers/tools for this session |
| `/mode coding\|general` | Session mode (coding + `rag.enabled` → code retrieval hints) |
| `/status` | Session, model, context, MCP summary, RAG index when enabled |
| `/reload` | Re-read workspace `config.json` into the live session |
| `/memory` | List / search / forget long-term vector memories |
| `/feeds <words>` | Search indexed feed stories (requires Feeds enabled; `/rss` alias) |
| `/feeds topics [range]` | Topic clusters for the window (`today`, `week`, `month`, `all`; default week) |
