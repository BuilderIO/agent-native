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
Project goal:
Configuration and constraints:
Knowledge sources:
Repeatable workflow:
Inputs and outputs:
Judgment and review points:
Representative runs: none, or 1-3 selected examples
Integrations and permissions:
Unknowns and follow-up:
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

In a new Project chat, say:

```text
Turn this project into an app. Use the visible Project instructions,
knowledge files, and any selected successful runs as the source. Create the
app in the connected Agent-Native workspace, keep the source brief bounded,
and report the real path and verification result.
```

If the host does not show the Project instructions or files to the model, stop
and request an export or attachment. Do not claim that the Project was read.
