---
name: turn-into-app
description: >-
  Turn visible project context, a proven thread, skill, or workflow into a
  runnable Agent-Native app with simple buttons, visible agent steps, preview,
  and deployment handoff. Use when a user invokes `/turn-into-app` or asks to
  make a workflow into an app, including from
  Claude or ChatGPT on the web, including when the source is a spreadsheet
  link or upload.
user-invocable: true
scope: both
metadata:
  internal: true
---

# Turn Into App

## Host execution boundary

Classify the runtime before choosing a build path. The presence of a Dispatch
or Builder connector does not make a coding host an online host:

- **Local coding host** - Codex Desktop/Code, Claude Code, Cursor, or any
  runtime with a terminal, filesystem, and target checkout. Build in that
  checkout: scaffold, edit, run, and verify the app locally. Do not call
  `start-workspace-app-creation`, `create_workspace_app`, or any Builder
  handoff for this path. The local implementation steps below are required.
- **Non-coding browser host** - Claude Web, ChatGPT Web, or a
  Claude/ChatGPT Project in the browser when no target checkout or filesystem
  is available. Act as the source analyst and handoff orchestrator. Do not run
  `npm`, `pnpm`, `npx`, `agent-native create`, or `add-app`; do not edit files,
  create artifacts, or start a local dev server. After writing the bounded
  source brief, call the connected Dispatch action
  `start-workspace-app-creation`. Pass the brief and repeatable workflow in
  `prompt`, plus the inferred `appId`, `description`, `template`, and selected
  `resourceIds` when available. This is the Builder handoff for browser hosts
  only.
- If the host is ambiguous, inspect the environment. A real cwd, terminal, and
  target workspace mean local coding host. Do not infer browser mode from the
  availability of a Builder connector.
- For the browser-only path, do not substitute the generic
  `create_workspace_app` MCP tool. That tool is a local workspace scaffolder,
  not the Builder handoff. Connect the Agent-Native Dispatch MCP connector
  only; Dispatch uses the authenticated Builder Projects API to reuse or
  provision the workspace project before starting the Builder Cloud Agent.
- If the browser-only handoff action is unavailable or Dispatch is not
  authenticated, stop with the connector setup needed. Do not fall back to a
  host sandbox build or claim that the app exists.
- Never invent a Builder branch URL. If Dispatch returns only an acknowledgement
  or a path without a URL, report the handoff as unverified rather than calling
  it a ready or verified Builder branch.

Once the source brief is sufficient to identify a repeatable workflow, the
handoff is non-interactive. Do not ask the user for visual, product, copy,
layout, template, integration, or implementation choices that can be resolved
from the source. Select the source's recommended option; otherwise choose the
most direct conventional default and record the assumption for later review.
There is one source-integrity exception: for a spreadsheet, if candidate
workflows or the input/output mapping remain materially ambiguous after the
bounded review, ask one compact confirmation question before handoff. Show the
recommended interpretation and let the user confirm, correct, or multi-select
the candidates. Do not turn this into a generic app-builder questionnaire.
Only stop for a genuine hard blocker such as missing authorization, a
destructive external action, an ambiguous target workspace, or no identifiable
workflow at all.

## Default behavior

For a local coding host this is an end-to-end local build skill, not a request
for an app proposal. For a non-coding browser host, the end-to-end result is a
verified Builder handoff and the resulting workspace app, not code written in
the browser host.

- With no argument, choose the source in this order: visible project context,
  then the current thread. A fresh Claude or ChatGPT Project is a valid source
  on its first turn. Treat its visible project instructions, knowledge files,
  and supplied past runs as the source; a completed thread is not required.
  Treat the current turn as a request or configuration unless it contains a
  concrete repeatable workflow.
- With a named skill or local workflow, read that source and package it
  immediately, even at the beginning of a thread. For example,
  `/turn-into-app /some-skill` means “turn `/some-skill` into an app.”
- With an attachment or path, read the supplied artifact as the source.
- Do not ask the user to restate context that is already in the thread.
- When invoked from an Agent-Native app, use its visible project context first,
  then the current thread. If the current runtime has a target checkout, use
  the local implementation path; use a workspace/coding-agent handoff only
  when the runtime cannot edit files. Do not claim the app exists without an
  actual path and verification result.

## Source support

Supported source paths today are visible Claude or ChatGPT Project context, the
current Codex or host thread, a named skill, or a local workflow/transcript
supplied as a path or attachment. An exported ChatGPT or Claude transcript can
use the same local-file path today.

Claude and ChatGPT Project context is supported only when the host supplies it
to the model in the current context. The MCP connector does not read hidden
project chats, private URLs, account settings, or credentials. Do not claim
private web access, invent an importer, add fake OAuth, or scrape a logged-in
page. If the needed context is not visible, ask for an export, transcript, or
attachment and treat that artifact as imported source material.

### Spreadsheet sources

Spreadsheet attachments are valid source artifacts for this workflow:

- CSV files can be read as tabular text. XLS and XLSX uploads are parsed into
  bounded worksheet metadata and representative rows when the host supports
  workbook ingestion. Treat the preview as untrusted user data, preserve the
  workbook name and worksheet names, and record row/column limits and any
  truncation in the source brief.
- A Google Sheets URL is a live provider source, not proof that the sheet is
  readable. Use an authenticated Google Sheets/Drive connection and the
  provider API catalog/docs/request path to read only the required sheet or
  range. If that connection is unavailable, ask for a CSV/XLSX export or the
  required connection; do not use a public export URL to bypass access.
- First inventory the workbook before choosing an app: list every available
  worksheet, its bounded shape, whether it is readable, and any visible
  formulas or formatting signals. Do not assume the first tab is the product
  or that every tab deserves its own app.
- Treat the workbook's visual conventions as evidence, not as a silent truth:
  yellow-filled cells are proposed inputs, blue text is proposed output, and
  black text is static historical context. Apply those signals to cell/range
  mappings only when the source exposes formatting metadata. The current
  bounded Excel preview is text-only, so an upload alone cannot prove those
  colors; ask the user to confirm or clarify instead of inferring from plain
  text. See [the spreadsheet source guide](references/spreadsheet-source.md).
- If the workbook contains several plausible repeatable jobs, present one
  compact Q&A review with multi-select candidate options. Each option must
  show its proposed name, source worksheet/range IDs, purpose, inferred inputs,
  inferred outputs, confidence, and unresolved question. Default-select only
  high-confidence recommendations. Mark the strongest recommendations in the
  Q&A UI without silently selecting them. When the user selects multiple candidates,
  implement them as separate named left-navigation destinations in one app,
  with each destination preserving its own source tabs/ranges and I/O mapping.
- In generated app code, render this review with
  `askUserQuestion` from `@agent-native/core/client/agent-chat` using
  `allowMultiple: true`, stable candidate IDs as option values, and
  `allowFreeText: true` for corrections. It renders inline in the agent panel;
  do not build a custom modal. Group a large workbook into 2-4 candidate jobs
  per question instead of presenting a tab dump.
- Before handoff or the first generated-app run, show the proposed source,
  inputs, outputs, static historicals, refresh/snapshot choice, and truncation
  limits as a review state. Let the user confirm or correct the mapping. Do not
  publish, overwrite the source, or claim a complete import before confirmation.
- Decide whether the generated app needs a one-time snapshot or a refreshable
  source. For a snapshot, pass bounded sample context and provenance to the
  local build or the browser-only Builder handoff selected by the host. For a
  live source, preserve the provider/file identity, worksheet or range, and
  refresh semantics, then implement a scoped action for reads or refreshes.
  Never copy workbook bytes, base64 data, credentials, or a full unbounded
  sheet into SQL, application state, or the handoff prompt.
- Do not claim the app imported the whole workbook when only a preview was
  available. Keep unreadable, partial, and failed source states distinct from
  an empty sheet.

For local coding hosts, deliver a fresh app in a new directory, implement the
repeatable workflow with buttons and agent handoffs, start its dev server,
verify the main path, and continue through build/deployment handoff. Do not stop
at a plan or route the work to Builder. For non-coding browser hosts, call
Dispatch first after the source brief, then report only the returned Builder
branch URL/path and verification result; if the URL is absent, say so plainly.

## Fresh project context mode

When the source is a fresh Claude or ChatGPT Project, build a short source brief
before creating the app. Read the host-provided context in this order:

1. Project instructions and configuration: goal, audience, constraints, output
   standards, approved tools, and integration expectations. Treat these as
   product configuration, not as a transcript.
2. Knowledge files and attachments: read the relevant files fully, preserve
   their provenance, and reduce them to bounded references, IDs, URLs, or
   summaries for the new app. Do not copy secrets or large raw payloads into
   prompts or SQL.
3. Past runs or examples that are actually visible in the context: select at
   most 1-3 successful, representative runs. Extract repeatable decisions and
   review criteria. Treat one-off answers and private data as examples, not as
   product behavior. If no runs are supplied, proceed from the instructions
   and knowledge files and say that examples were not available.
4. The current turn: use it for the requested app boundary, target workspace,
   naming, and any explicit corrections.

Record the brief with these headings before handoff: source and provenance,
project goal, configuration and constraints, knowledge sources, repeatable
workflow, inputs and outputs, judgment and review points, representative runs,
integrations and permissions, and unknowns and assumptions. This is the compact contract for
the app. It keeps the new app useful without pretending that hidden Project
history was imported. See [the fresh Project reference](references/fresh-project.md)
for the host setup and brief template.

If the visible Project context has no concrete repeatable job and no primary
goal can be inferred, ask for one focused clarification or a representative
artifact. Otherwise use the project's primary goal and source conventions; do
not ask a questionnaire and do not fall back to a generic “what app do you
want to make?” builder.

## Source selection guard

The generated app must implement the concrete workflow found in the source. It
must not become a generic “what app do you want to make?” intake form.

- In a delegated or forked task, read the actual referenced source thread and
  the latest explicit workflow direction in the current task. If they disagree,
  the latest concrete workflow direction wins.
- Do not treat a thread that merely discusses building this skill as the product
  source unless the user explicitly asks to appify that meta-workflow.
- If the source contains several workflows, choose the latest successful,
  repeatable job that motivated the request and name it in the handoff. If no
  concrete job can be identified, stop and report what is missing instead of
  inventing an app-builder UI.

## UI contract for generated apps

Generated apps must follow the shared Agent-Native surface model:

- Keep the domain workflow on a named route (`/workflow`, `/automations`,
  `/block`, or the source's equivalent). Preserve the scaffold's full-page
  chat route instead of replacing it with a domain form while leaving the
  layout configured as a chat page.
- Use the right `AgentSidebar` for contextual AI. Every button-triggered
  `sendToAgentChat` handoff should open or focus that sidebar and keep the user
  on the current domain page.
- Every AI-labeled button must actually call `sendToAgentChat` with bounded
  context and `openSidebar: true`. Label deterministic local actions as local,
  preview, or analyze instead of AI.
- Never use sparkle, wand, magic, robot, or similar decorative AI icons. Use a
  message or neutral action icon, or no icon when the button label is enough.
- Make the left navigation describe domain destinations. Chat is a separate
  destination, not the label for every app page.
- For a spreadsheet-derived app with multiple confirmed candidates, make each
  candidate a separate named left-navigation destination. Keep the shared
  source provenance visible, but show that candidate's selected worksheets,
  ranges, inputs, outputs, historical context, and confirmation state on its
  destination.
- Start with one primary action and one compact state. Put setup choices,
  advanced inputs, diagnostics, and long explanations behind progressive
  disclosure or later workflow steps.
- Choose a named visual direction in `DESIGN.md` before styling and build to it.
  Preserve existing brand tokens; a new unbranded app picks its own
  product-fitting palette rather than inheriting a sibling app's accent.
- Standalone apps that render `AgentSidebar` must keep one assistant-ui runtime
  context. Pin the versions compatible with the installed core/toolkit peer
  graph, and add Vite dedupe/aliases when linked or transitive packages resolve
  duplicate assistant-ui modules. Verify a fresh AI handoff has no
  `AssistantUiStaleIndexErrorBoundary` or stale-index console error.
- Before handoff, inspect the first viewport and remove the text density,
  repeated cards, unrelated forms, and generic helper copy the user does not
  need until the next decision.

In a local code-agent runtime, read `frontend-design` for the visual direction
contract, aesthetic guidelines, and named review passes behind these rules.

## 1. Extract the workflow

Read the full available source before coding. Reduce it to a short working
brief:

- the user and repeatable job;
- inputs and outputs;
- the 1-3 judgment-heavy agent moments;
- the buttons, review points, and retry states a user needs;
- data, permissions, integrations, and failure boundaries.

For a spreadsheet source, also include the workbook/file or spreadsheet ID,
worksheet and range candidates, source snapshot/live semantics, formatting
signals and their confidence, selected candidate destinations, and the exact
confirmation or clarification still needed. A spreadsheet's inputs and
outputs have two layers: the mapped source cells/ranges, and the generated
app's user-facing results/actions. Name both so the Builder does not confuse
an output cell with an app write or a historical value with an editable input.

Preserve useful judgment from the source, but do not turn a one-off answer,
private data, or an unverified result into a product contract. If the source is
not available or does not contain a repeatable job, say what is missing rather
than claiming the app is complete.

## 2. Create a fresh app

Choose a short slug from the workflow and create a new directory. Never
overwrite an existing app. If the user supplied a directory, use it; otherwise
use `apps/<slug>` inside an existing Agent-Native workspace, or a new sibling
directory when working outside one.

For a new UI-bearing standalone app, use the current Agent-Native scaffold and
then read the generated `AGENTS.md`:

```bash
npx @agent-native/core@latest create <app-directory> --template chat
cd <app-directory>
pnpm install
```

When working inside an existing Agent-Native workspace, create the app from
the workspace root instead:

```bash
pnpm exec agent-native add-app <slug> --template=chat
```

Do not use `create` for an existing workspace; it scaffolds a new standalone
workspace rather than adding an app to the current one.

When the source came from a fresh external Project and the target is a Builder
workspace, the browser-only host path is mandatory: after writing the source
brief, call `start-workspace-app-creation` with a concise prompt, the inferred
app id, and the brief's repeatable workflow. Pass selected workspace resource
IDs when they are available, rather than pasting entire knowledge files.
Continue from the returned workspace path or Builder branch handoff and report
the actual verification result. This rule does not override local host
classification: Codex/Claude Code with a target checkout must build locally.

Use a first-party template only when it materially fits the workflow. Keep the
new app independent from the source thread's working tree unless the user
explicitly asks to extend an existing app.

Read the generated `DESIGN.md` before building the first screen and fill in the
visual direction as part of the app brief. Do not copy the previous app's
palette just because its tokens are nearby.

## 3. Turn the workflow into buttons and agent work

Implement the smallest useful surface around the extracted brief. The app
should make the repeated path obvious without hiding the agent's judgment:

- Give each important repeated moment a clear button, such as “Analyze,”
  “Suggest options,” “Draft,” “Review,” or “Publish.” Use the source's actual
  vocabulary when it is clear.
- Put deterministic reads, writes, approvals, provider fetches, and publishing
  in focused `actions/` with `defineAction`. The UI and agent must call the
  same action surface.
- If a workflow is framed as research, analysis, generation, recommendation,
  or synthesis, start it in the AgentSidebar and let the agent orchestrate
  those actions. Do not hide an AI-shaped multi-step workflow behind one
  opaque action just because the implementation is deterministic.
- Use application state for the current screen, selected item, and focused
  object so the agent can see where the user is.
- Use `sendToAgentChat({ message, context, submit: true, openSidebar: true })`
  for intentional button-triggered agent work. Use `submit: false` when the
  user should review or edit the proposed prompt in the AgentSidebar first.
  Keep follow-up and revision prompts in that same thread; do not add a second
  freeform textbox beside the result.
- Pass IDs, URLs, and bounded summaries in context. Do not paste large provider
  dumps into prompts, call an LLM directly from the browser, or invent fake
  progress.
- Make agent results visible, editable, retryable, and attributable. Keep
  irreversible actions behind an explicit review or confirmation point.

Use the existing shadcn/ui primitives, Tabler icons, shared composer, and
optimistic action patterns. Do not add a parallel CRUD API route for an action.

## 4. Keep onboarding shared

Use the framework's existing setup experience. The app should offer the normal
“Connect Builder” and “Add your own keys” paths for AI setup. Do not create a
second credential form or hardcode a provider key.

In local-development instructions, add a brief note that a developer can set
an environment variable such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` before
starting the app; after restart, the setup prompt is no longer shown when the
key is available. Keep real secrets out of source, examples, and generated
content.

Turn-into-app apps should commit an `agent-native.json` app configuration so a
plain `pnpm dev` has the right first-run behavior without extra flags:

```json
{
  "version": 1,
  "onboarding": {
    "firstRun": {
      "development": "connect",
      "production": "connect-and-integrations"
    }
  }
}
```

`connect` keeps the Connect Builder / Add your own keys choice visible and
skips only the generic “This app is an agent.” integrations catalog. The
production value includes that catalog for a hosted app. Do not replace this
with a local credential form or remove the shared onboarding. In development,
the shared Connect Builder card also explains the deployment-level
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` fallback and links to the full
environment-variable guide.

When the onboarding default needs code rather than a static mode map, add an
optional `agent-native.config.ts` with the same returned shape:

```ts
import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig(({ isDev }) => ({
  version: 1,
  onboarding: {
    firstRun: isDev ? "connect" : "connect-and-integrations",
  },
}));
```

The Vite preset loads this file automatically on supported Node versions. The
JSON file remains the portable, inspectable fallback. See the [Agent-Native
app configuration guide](/docs/agent-native-config) for precedence, supported
modes, and the boundary between committed config and deployment secrets.

For an account-free local preview, create the ignored local `.env` file with
`AUTH_DISABLED=1` before starting the dev server. This is only for loopback
development; never commit or deploy this setting. AI/provider connections still
use the normal onboarding flow or the documented environment-variable keys.

## 5. Run it immediately

From the new app directory:

```bash
pnpm dev
```

For a fresh local test app, use the ignored `.env` with `AUTH_DISABLED=1` so the
domain UI opens without an account; the committed app config makes shared
onboarding visible. Keep the process running so the user can try the app. Read
the actual server output and report the real local URL. If the app needs installation or a setup step,
complete it when possible and distinguish “not configured” from an unavailable
credential store.

## 6. Verify, build, and deploy

Exercise the actual happy path, not only the source files:

1. Load the reported URL and confirm the main route renders.
2. Confirm the shared onboarding state or a configured local key.
3. Click the primary workflow button and confirm the intended agent handoff.
   Also click every other AI-labeled button and confirm it opens the same
   contextual sidebar with the expected prompt or staged context.
4. Confirm the result, action persistence, application state, and sync path.
5. Check the dev output for browser/runtime errors, and capture input, result,
   and agent-sidebar states so the complete flow is reviewable.

Then run the supported build. For a standalone app, use the generated app's
documented build and hosting path. For an app inside a workspace, use the
workspace deploy command, for example:

```bash
npx @agent-native/core@latest build
npx @agent-native/core@latest deploy --preset netlify
```

Use `vercel` or another supported preset when that is the configured target.
Attempt deployment when the user requested it or the project already has the
required provider configuration. If external authentication, a production
secret, or a hosting decision is missing, finish local verification and report
the exact remaining handoff without claiming a live deployment.

Label evidence separately: locally running, locally verified, build-ready,
deployed, and live-verified are different states.

## Handoff

End with the new app directory, local URL, visual direction, what the buttons do,
account-free local-preview status, verification performed, deployment URL if it is real,
and one precise pending step when something could not be completed. Keep the
handoff short enough to use in a demo or recording.
