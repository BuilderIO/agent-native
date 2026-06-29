# Local-files privacy mode — single source of truth

This file is the canonical contract for fully local, no-database planning and
recaps. It is shared word for word by `/visual-plan` and `/visual-recap`. Read it
in full before using local-files mode; do not call any hosted Plan tool for a
local plan/recap except the schema-only block-catalog lookup described below.

<!-- SHARED-CORE:local-files START -->

**When to use it.** Use local-files privacy mode when the user explicitly asks
for no DB writes, no hosted Plan database writes, no Plan MCP publish, fully local
files, offline/private work, or repo-owned/source-controlled artifacts, or when
`AGENT_NATIVE_PLANS_MODE=local-files` is set. Also use it when a user or repo
policy says the work must stay under their own brand, domain, source control, or
infrastructure. In this mode the plan/recap data must never be sent to the Plan
MCP server or the Plan app action surface. This is the only exception to the
always-publish rule in `references/connection.md`.

The local-files contract:

- **Read context locally.** Read source, diff, and stat context from local files
  and shell commands only. For recaps, the
  `npx @agent-native/core@latest recap collect-diff`, `scan`, and
  `build-prompt --local-files` helpers are safe — they operate on local files and
  do not write to the Plan database.
- **Fetch the block catalog first** (it sends no plan content). Use the MCP
  `get-plan-blocks` tool if it is already available, or run
  `npx @agent-native/core@latest plan blocks --out plan-blocks.md` and read that
  file before authoring MDX; it calls the public no-auth `get-plan-blocks` route.
  Use `--format schema` when you need exact nested fields. If network access is
  unavailable, use the bundled `references/*.md` and rely on `plan local check` to
  catch invalid tags. Copy the catalog examples verbatim for the fields the
  registry table cannot encode: `checklist` items need `id` and `label`;
  `question-form` questions need `id`, `title`, and `mode`, and each option needs
  `id` and `label`; and `Code` / `AnnotatedCode` / `Diff` are whitespace-sensitive
  — encode multiline code as JSON string attributes such as `code={"const x =\n  y"}`
  (a static template literal is accepted only when it has no `${...}`
  interpolation). `plan local check` is a quick OFFLINE lint (a subset of the
  renderer schema), so a green `check` does not guarantee the plan renders;
  `plan local verify` is the authoritative validation against the real renderer
  schema.
- **Write a local MDX folder.** Use `plans/<slug>/` to check the artifact into the
  repo, or a repo-ignored/temporary folder such as `.agent-native/plans/<slug>/`
  or `/tmp/agent-native-plans/<slug>/` when it should not be checked in. The
  folder holds `plan.mdx`, optional `canvas.mdx`, optional `prototype.mdx`, and
  optional `.plan-state.json`. For a recap, set `kind: "recap"` and
  `localOnly: true` in the frontmatter/state. Use that exact folder as
  `<plan-dir>` in every command below.
- **Check, then serve.** Run
  `npx @agent-native/core@latest plan local check --dir <plan-dir>` before any
  preview, then
  `npx @agent-native/core@latest plan local serve --dir <plan-dir> --kind <plan|recap> --open`
  (use `--kind plan` for plans, `--kind recap` for recaps). Report the local
  bridge URL from stdout or `<plan-dir>/.plan-url`; treat `.plan-url` as a local
  token file and do not commit it. The URL opens the hosted Plan UI but reads from
  the localhost bridge on this machine, so it is not shareable across machines. On
  macOS `--open` prefers Chromium browsers; if Safari opens, switch to
  Chrome/Chromium because Safari can block the hosted HTTPS page from fetching the
  HTTP localhost bridge. If the Plan app itself is running locally with the same
  `PLAN_LOCAL_DIR`, the `/local-plans/<slug>` route is also valid. In a truly
  offline environment, hand off the `<plan-dir>` path after `plan local check` and
  note that interactive preview requires network access to the hosted Plan UI or a
  running local Plan app.
- **Headless verify.** Run
  `npx @agent-native/core@latest plan local verify --dir <plan-dir> --kind <plan|recap>`.
  It starts the bridge, checks the private-network preflight and JSON payload, AND
  validates the content against the real renderer schema via the Plan app's
  `validate-local-plan-source` action. A non-`ok` result with
  `validation.valid: false` lists the renderer's exact schema-path issues (e.g.
  `blocks[1].data.tabs[0]...`); fix those before handing off. If `validation.ran`
  is `false`, the Plan app did not expose the validate endpoint (older/unreachable
  deploy) — point `--app-url` at a current Plan app (e.g. a local
  `http://localhost:8096`) for the authoritative check. If the browser hangs on
  "Loading plan", fetch the `bridgeUrl` from the verify/serve JSON to read the
  concrete validation error.
- **Never call hosted tools for that plan/recap.** Do not call
  `create-visual-plan`, `create-ui-plan`, `create-prototype-plan`,
  `create-plan-design`, `create-visual-recap`, `create-visual-questions`,
  `import-visual-plan-source`, `update-visual-plan`, `patch-visual-plan-source`,
  `get-plan-feedback`, `export-visual-plan`, `set-resource-visibility`, or any
  other hosted Plan tool — except the schema-only block-catalog lookup above.
- **Feedback is file/chat feedback.** Update the MDX files directly, rerun
  `plan local check`, and rerun `serve` or `verify` when that preview path is
  available. Summarize the new local URL when one exists; otherwise summarize the
  checked `<plan-dir>` path. Hosted comments, sharing, screenshots, history, usage
  attachment, and publish/export receipts are unavailable until the user
  explicitly opts into publishing.

Local-files mode only prevents plan/recap content from reaching the Agent-Native
Plan database. It does not by itself make the coding agent's language model local;
for that stronger boundary the host agent/model must also be local or otherwise
approved by the user.

<!-- SHARED-CORE:local-files END -->
