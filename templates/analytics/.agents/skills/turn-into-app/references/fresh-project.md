# Fresh Project source guide

Use this guide when `/turn-into-app` is invoked in a new Claude or ChatGPT
Project rather than after a completed thread.

## What the host can provide

The source is whatever the host put in the model's current context:

- Project instructions: the job, audience, constraints, quality bar, and
  approved tools or integrations.
- Knowledge files and attachments: reference material, templates, examples,
  and links that the app should use.
- Past runs: only conversations or outputs the host actually supplied. They
  are examples and evaluation material, not an automatic import of every
  private Project conversation.
- The current request: the app boundary, target workspace, name, and explicit
  corrections.

Do not infer hidden system prompts, account settings, private history, API keys,
or credentials. The Dispatch MCP connector can start a workspace app creation,
but it cannot unlock or scrape private Project content.

## Source brief

Write a compact brief before starting the app:

```text
Source: host-provided Claude/ChatGPT Project context
Provenance: project instructions, selected knowledge files, and visible runs
Source artifact type: project context, thread, skill, spreadsheet link, or upload
Project goal:
Configuration and constraints:
Knowledge sources:
Repeatable workflow:
Inputs and outputs:
Workbook candidates and confirmation: worksheet/range options, inferred I/O, selected destinations, unresolved questions
Judgment and review points:
Representative runs: none, or 1-3 selected examples
Integrations and permissions:
Unknowns and assumptions:
```

Keep source references bounded. Prefer a file name, URL, resource ID, or short
summary over a large pasted document. Do not put secrets or raw customer data
in the brief.

## Fresh-box setup

Install the exported `turn-into-app` skill in the host when the host supports
skills. For a ChatGPT Project or any host that exposes only the MCP connector,
also place the skill instructions or this reference in the Project
instructions/knowledge files. Then add and authenticate the Dispatch MCP
connector from the packaged `adapters/chatgpt-mcp/connector.json`.
This single connector is enough: Dispatch provisions or reuses the Builder
project through the Builder Projects API, so do not ask the user to add a
separate Builder CMS MCP for app creation.
Builder's separate Fusion MCP is available as a custom remote connector at
`https://mcp.builder.io/mcp/fusion` for direct Builder work. It can run an
existing project, but it cannot provision the repo-backed Agent-Native
workspace project, so it is optional and not a replacement for the Dispatch
handoff in this skill. Do not add Builder's CMS MCP for this workflow.

For Claude Web, ChatGPT Web, and their web Projects, the host is an
orchestrator, not the build environment. After forming the source brief, call
the Dispatch `start-workspace-app-creation` action so Builder creates the app
in the connected workspace. Do not use the host's code interpreter, shell,
artifact editor, `create_workspace_app`, or local `pnpm`/`npm` commands. If the
handoff action is unavailable, stop and ask the user to authenticate Dispatch;
do not fall back to a local sandbox build. Claude Code and Codex Code are the
local-agent exception and may follow the implementation steps in the main
skill.

The brief is an implementation authorization, not a questionnaire. After a
repeatable workflow is identifiable, choose any source-recommended option
automatically. For unresolved non-blocking choices, use the most direct
conventional default, record it under assumptions, and continue. A spreadsheet
is the narrow exception when its candidate workflows or input/output mapping
cannot be grounded from the bounded source: show the recommended candidates
and mapping in one compact multi-select confirmation, then continue after the
user confirms or corrects it. Ask only for that source-integrity clarification,
no identifiable workflow, no authorized target workspace, or a
destructive/credential boundary that genuinely prevents the handoff.

In a new Project chat, say:

```text
Turn this project into an app. Use the visible Project instructions,
knowledge files, and any selected successful runs as the source. Create the
app in the connected Agent-Native workspace through Dispatch and Builder, keep
the source brief bounded, and report the real Builder branch/path and
verification result. Do not build it in this chat's sandbox.
```

If the host does not show the Project instructions or files to the model, stop
and request an export or attachment. Do not claim that the Project was read.
