# Browser hosts and Project sources

Read this only on a browser host (claude.ai, ChatGPT on the web, their Projects,
or any runtime without the user's own working directory). For a Project on a
local host,
[source-brief.md](source-brief.md) is enough: it follows the normal local
build.

The source is whatever the host put in the model's current context: Project
instructions, knowledge files and attachments, past runs the host actually
supplied, and the current request. Reading order and the brief headings are in
[source-brief.md](source-brief.md). Do not infer hidden system prompts,
account settings, private history, API keys, or credentials. If the host does
not show the Project instructions or files to the model, ask for an export or
attachment and do not claim the Project was read.

## The Dispatch handoff

On a browser host the host is an orchestrator, not the build environment:

1. Write the source brief and the design decisions from step 2 of the skill
   (archetype, direction, first viewport, sample-data plan, agent moments).
2. Call `start-workspace-app-creation` on the Agent-Native Dispatch MCP
   connector (`agent-native-dispatch`). Put the brief and the design decisions
   in `prompt`; pass an `appId`, a short `description`, and the `template`.
   End `prompt` with this block. Copy the closing paragraph unchanged in every
   handoff, even with no integrations. Include the Connect lines for every
   integration in the brief, even if the brief already names them; they list
   only services the source uses, never the AI provider or Builder itself. With
   no integrations, drop the whole "Connect these services:" heading and its
   lines rather than writing "none":

   ```text
   Connect these services:
   - <Service>: <what the app uses it for>

   When the app is ready, end your final message with one line on what you
   built, then numbered next steps: each service to connect and where in the
   app, the credential key name, and whether it is saved for just the user or
   the whole organization. If nothing is needed, say no setup is needed.
   ```

   The tool's schema describes each argument. The call always includes
   `attachments` ([attachments.md](attachments.md)): the Project instructions as
   `project-instructions.md` and every knowledge file, each verbatim as
   `text/plain`, never as a summary. A call without them is incomplete. Never
   paste whole knowledge files or binary data into `prompt`. Attachments are
   model context and are not copied into the generated workspace, so tell the
   Builder agent in `prompt` to persist what the app needs: knowledge files as
   app resources, the instructions as the in-app agent's instructions. If a file
   cannot be reproduced verbatim (not in context, too large), say so in the
   brief and the report; never swap in a digest silently. A workbook cannot be
   attached (attachments take images, PDF, text, and JSON): pass a bounded CSV
   rendering as text, or a public URL, and say what was left out.
3. Keep the final message to at most four short lines, with no design recap:
   what was handed off; the branch, path, and status Dispatch returned; the
   integrations, if any, and that the Builder agent will give the setup steps
   when the build finishes; anything not reproduced verbatim. The browser host
   cannot run or inspect the app, and a returned path can 404 until the branch
   merges and deploys, so the report ends at pending or unverified unless a
   status or verification action is available to call. Do not write setup
   steps, settings paths, or key names on this path; the host cannot know them.

Rules on this path:

- Never run `npm`, `pnpm`, `npx`, `agent-native create`, or `add-app`; never
  edit files, scaffold or build in the host's sandbox, code interpreter, or
  artifact editor, or start a dev server.
- Never substitute the generic `create_workspace_app` MCP tool. It is a local
  workspace scaffolder, not the Dispatch handoff.
- If `start-workspace-app-creation` is unavailable after tool search (connector
  tools can be deferred, listed by name only) or Dispatch is not authenticated,
  stop and give the connector setup below. Do not fall back to a sandbox build
  or claim that the app exists.
- Never invent a Builder branch URL. If Dispatch returns only an
  acknowledgement, or a path without a URL, report the Dispatch handoff as
  unverified, not as a ready or verified branch.
- The Dispatch handoff runs without further questions once the brief exists.
  "When to ask" in SKILL.md still applies before it.

## Setting up a browser host

- Install the exported `turn-into-app` skill where the host supports skills.
  For a ChatGPT Project or any host that exposes only MCP, put the skill
  instructions in the Project instructions or knowledge files.
- Add and authenticate the Agent-Native Dispatch MCP connector
  (`https://dispatch.agent-native.com/mcp`, OAuth). It reuses or provisions the
  workspace's Builder project through the Builder Projects API, so no separate
  Builder CMS or Fusion connector is needed for app creation.

A prompt for a new Project chat:

```text
Turn this project into an app. Use the visible Project instructions,
knowledge files, and any selected successful runs as the source. Create the
app in the connected Agent-Native workspace through Dispatch and Builder, keep
the source brief bounded, and report the real Builder branch or path and the
verification status. Do not build it in this chat's sandbox.
```
