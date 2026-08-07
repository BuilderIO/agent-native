---
name: turn-into-app
description: >-
  Turn visible project context, a proven thread, skill, or workflow into a
  runnable Agent-Native app with simple buttons, visible agent steps, preview,
  and deployment handoff. Use when a user invokes `/turn-into-app` or asks to
  make a workflow into an app.
user-invocable: true
scope: both
metadata:
  internal: true
---

# Turn Into App

## Default behavior

This is an end-to-end build skill, not a request for an app proposal.

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
  then the current thread, and use the available workspace/coding-agent
  handoff when the current runtime cannot edit files. Do not claim the app
  exists without an actual path and verification result.

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

Deliver a fresh app in a new directory, implement the repeatable workflow with
buttons and agent handoffs, start its dev server, verify the main path, and
continue through build/deployment handoff. Do not stop at a plan.

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
integrations and permissions, and unknowns. This is the compact contract for
the app. It keeps the new app useful without pretending that hidden Project
history was imported. See [the fresh Project reference](references/fresh-project.md)
for the host setup and brief template.

If the visible Project context has no concrete repeatable job, ask for one
focused clarification or a representative artifact. Do not fall back to a
generic “what app do you want to make?” builder.

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
- Use a sans-first SaaS hierarchy for the app shell. Choose a named visual
  direction in `DESIGN.md` before styling: product mode, audience, palette
  family, type treatment, composition, shape language, and anti-references.
  One restrained editorial cue is welcome, but warm beige plus terracotta is
  not the default and serif type belongs in content previews or a deliberate
  brand moment rather than the whole tool.
- Preserve existing brand tokens. For a new unbranded app, choose a
  product-fitting palette family and compare sibling apps before reusing their
  accent. Keep shared semantic tokens and Agent-Native behavior consistent
  while varying the visual world, density, composition, and shape language.
- Give the AgentSidebar a subtle surface or divider boundary so it is visually
  distinct from the domain page without becoming a heavy panel wall.
- Every AI-labeled button must actually call `sendToAgentChat` with bounded
  context and `openSidebar: true`. Keep `submit: true` for direct execution and
  `submit: false` only when the user should edit the staged prompt first. Label
  deterministic local actions as local, preview, or analyze instead of AI.
- Standalone apps that render `AgentSidebar` must keep one assistant-ui runtime
  context. Pin the versions compatible with the installed core/toolkit peer
  graph, and add Vite dedupe/aliases when linked or transitive packages resolve
  duplicate assistant-ui modules. Verify a fresh AI handoff has no
  `AssistantUiStaleIndexErrorBoundary` or stale-index console error.
- Make the left navigation describe domain destinations. Chat is a separate
  destination, not the label for every app page.
- Start with one primary action and one compact state. Put setup choices,
  advanced inputs, diagnostics, and long explanations behind progressive
  disclosure or later workflow steps.
- Never use sparkle, wand, magic, robot, or similar decorative AI icons. Use a
  message or neutral action icon, or no icon when the button label is enough.
- Before handoff, inspect the first viewport for text density, repeated cards,
  unrelated forms, and generic helper copy. Remove what the user does not need
  until the next decision.
- Run a `distill`, `typeset`, `colorize`, `layout`, `polish`, and `audit` pass
  as useful named reviews. Make one intervention at a time and commit the
  chosen direction rather than averaging several options into generic SaaS.
- For before/after or original/generated review, stack the source first and the
  result second by default. Reserve side-by-side layouts for short content that
  remains comfortable to scan at the target width.

## 1. Extract the workflow

Read the full available source before coding. Reduce it to a short working
brief:

- the user and repeatable job;
- inputs and outputs;
- the 1-3 judgment-heavy agent moments;
- the buttons, review points, and retry states a user needs;
- data, permissions, integrations, and failure boundaries.

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
workspace, prefer the available Dispatch MCP workspace handoff after writing
the source brief. Call `start-workspace-app-creation` with a concise prompt,
the inferred app id, and the brief's repeatable workflow. Pass selected
workspace resource IDs when they are available, rather than pasting entire
knowledge files. Continue from the returned workspace path or Builder handoff
and report the actual verification result.

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
- Put deterministic reads, writes, approvals, and publishing in `actions/`
  with `defineAction`. The UI and agent must call the same action surface.
- Use application state for the current screen, selected item, and focused
  object so the agent can see where the user is.
- Use `sendToAgentChat({ message, context, submit: true })` for intentional
  button-triggered agent work. Use `submit: false` when the user should review
  or edit the proposed prompt first.
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
