# {{APP_NAME}} — Enrichment (Agent-Native)

## Overview

This project is an **enrichment template** built on **@agent-native/core**. You help users **enrich CSV datasets** using **Exa Websets**: uploaded rows become searchable targets, Exa finds and verifies web data, and results merge back into structured JSON the user can export.

- **Primary workflow:** import CSV → create/run enrichment → review merged results → export CSV.
- **All AI through agent chat** — No inline LLM calls in app code. Use registered scripts (`pnpm script <name>`) for operations that touch Exa or local data files.

## Architecture

### Files as database

Application state for imports, jobs, and exports is **JSON (and CSV) on disk** under `data/`, not SQL tables for enrichment payloads:

| Area        | Location                     | Role                                    |
| ----------- | ---------------------------- | --------------------------------------- |
| Imports     | `data/imports/{id}.json`     | Parsed CSV metadata + rows after upload |
| Enrichments | `data/enrichments/{id}.json` | Job status, webset IDs, merged results  |
| Exports     | `data/exports/*.csv`         | Generated CSV from enrichment results   |

Core may still use shared infrastructure (e.g. auth/session); **treat user datasets and enrichment artifacts as file-backed** under `data/`.

### SSE sync

File-backed changes integrate with the default real-time pipeline: the UI stays updated when data changes. The SSE endpoint is served at **`/api/events`** (see `server/routes/api/events.get.ts`). File sync is wired via `server/plugins/file-sync.ts` (default file sync from core).

### Scripts (agent tools)

Callable operations live in **`scripts/`** and are registered in **`scripts/registry.ts`**. Run with:

```bash
pnpm script <script-name> --flag value
```

The agent should prefer these scripts over ad-hoc HTTP or shell that bypasses the app’s data layout.

### Server routes

**Nitro / H3** file-based API routes live under **`server/routes/`** (e.g. `server/routes/api/`). Examples: uploads, listing imports/enrichments, exports, events.

### Authentication

Auth follows the standard template: `server/plugins/auth.ts` with `autoMountAuth`. In dev, auth is typically bypassed; in production, configure `ACCESS_TOKEN` or `AUTH_DISABLED` as documented for agent-native apps. Use `getSession(event)` / `useSession()` where needed.

### Directory structure (high level)

```
app/                   # React UI (upload, table, enrich, export)
server/routes/api/     # REST-style API (upload, imports, enrichments, exports, events)
server/plugins/        # auth, file-sync, agent-chat, etc.
scripts/               # Agent-callable tools (see registry)
data/                  # imports/, enrichments/, exports/ (user data; gitignored patterns apply)
shared/                # Shared types / API helpers
.agents/skills/        # Agent skills (including Exa — see below)
```

## Available tools (scripts)

These names match **`scripts/registry.ts`**:

| Script                 | Purpose                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| **`create-webset`**    | Full enrichment lifecycle: create Exa Webset, wait for results, merge into enrichment record, mark complete. |
| **`check-webset`**     | Check status of an in-progress enrichment job.                                                               |
| **`get-results`**      | **Recovery:** fetch items from an existing webset and merge into local enrichment data.                      |
| **`export-csv`**       | Generate a CSV export from enrichment results.                                                               |
| **`list-imports`**     | List available datasets (imports).                                                                           |
| **`list-enrichments`** | List enrichment jobs.                                                                                        |

Use **`list-imports`** / **`list-enrichments`** before acting when the user is vague about which dataset or job to use.

## Happy path

When the user says something like **“enrich this data”**:

1. **Import** — User uploads CSV via the UI → an import is created at **`data/imports/{id}.json`**.
2. **Enrich** — User clicks **Enrich** or asks you → run **`create-webset`** with the right import/job arguments (per script `--help` or source).
3. **`create-webset`** — Creates the webset → waits → fetches items → merges results → completes the job record.
4. **Report** — Summarize what ran: job id, row counts, notable columns, and where to find results in the UI or files.
5. **Export** — User clicks **Export** or asks → run **`export-csv`** to produce downloadable output under **`data/exports/`**.

## Recovery

- If **`create-webset`** was interrupted or the chat ended mid-run → run **`check-webset`** on the relevant enrichment job, then **`get-results`** to fetch from the existing webset and merge.
- If merged data looks wrong → user can ask you to re-run **`get-results`** or adjust queries/enrichments (may require code or argument changes — see customization).

Always prefer **idempotent, script-driven** recovery over duplicating websets unless the user wants a fresh run.

## CSV interpretation

Help users choose sensible Exa usage:

- **Infer column types:** names, emails, domains, company names, titles, locations, URLs.
- **Search mode:** Prefer **people**-oriented search when columns look like persons + roles + employers; **company** when domains, legal names, or industry fields dominate. **Auto** when mixed — explain your assumption.
- **Common formats:** `"First Last"`, `first.last@company.com`, bare **`company.com`** — map these to stronger queries (e.g. include domain or company column in webset creation when available).

For Exa-specific behavior (search types, enrichment descriptions, limits), read **`.agents/skills/exa-enrichment/SKILL.md`**.

## Customization patterns

Users may ask you to:

| Ask                                   | You might do                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| “Add a column for LinkedIn profiles”  | Adjust enrichment **descriptions** or merge mapping in scripts / server Exa integration (`server/lib/exa.ts` and related). |
| “Only enrich rows where country = US” | **Filter** rows before webset creation (script or preprocessing), or document a two-step import.                           |
| “Use a different search query”        | Customize webset **creation** arguments or code paths used by **`create-webset`**.                                         |
| “Score results by relevance”          | **Post-process** merged JSON (script or small utility) before export.                                                      |

Keep changes minimal and consistent with existing patterns; extend scripts rather than one-off chat instructions when the behavior should repeat.

## Safety

1. **Never expose `EXA_API_KEY`** (or any secret) in chat, logs you paste to the user, or committed files.
2. **User data stays under `data/`** for imports, enrichments, and exports — do not scatter copies elsewhere without a good reason.
3. **`.gitignore`** excludes typical user artifacts (`data/imports/*.json`, `data/enrichments/*.json`, `data/exports/*.csv`, env files). Do not weaken those rules for convenience.

## Learnings & preferences

**Read `learnings.md` at the start of substantive work** when it exists — it holds user-specific preferences and prior corrections.

**Update `learnings.md`** when you learn something that should apply to future sessions (workflow preferences, column naming conventions for their CSVs, etc.).

---

## Skills reference

Detailed **Exa Websets** guidance (search types, enrichment types, troubleshooting) lives here:

- **`.agents/skills/exa-enrichment/SKILL.md`**

Other skills in `.agents/skills/` (e.g. **`scripts`**, **`delegate-to-agent`**, **`frontend-design`**, **`self-modifying-code`**) apply to general agent-native patterns — read them when editing scripts, UI, or architecture.

## Framework notes

- **React Router v7** (framework mode), **Vite**, **Tailwind**, **shadcn/ui**.
- **API routes:** add files under `server/routes/api/` following existing naming conventions.
- **New scripts:** add `scripts/my-script.ts`, register in **`scripts/registry.ts`**, use `parseArgs`, `loadEnv`, `fail` from `@agent-native/core` as in **`scripts` skill**.

## Tech stack

- **Framework:** @agent-native/core + React Router v7
- **Backend:** Nitro (file-based routes, plugins)
- **Enrichment:** Exa Websets (API key via env)
- **Dev:** `pnpm dev` · **Build:** `pnpm build` · **Production start:** `node .output/server/index.mjs`
