---
name: contracts
description: >-
  Use Contracts for coding-agent work that needs assumption review, mid-flight
  feedback, acceptance criteria, evidence capture, and proof-before-done
  through the hosted Contracts MCP app.
metadata:
  visibility: exported
---

# Contracts

Use Contracts as the trust layer for non-trivial coding work. It records what
the agent is assuming, lets a human correct those assumptions before they become
code, and keeps acceptance criteria separate from verified evidence.

## Setup

Recommended install path:

```bash
npx @agent-native/core@latest skills add contracts
```

That installs these instructions and registers the hosted Contracts MCP
connector for the selected agent client. Add `--client claude-code`,
`--client codex`, or `--client all` when needed.

OAuth-capable hosts can add this remote MCP URL directly:

```text
https://contracts.agent-native.com/_agent-native/mcp
```

## When To Use

Create or update a contract when:

- the user asks for Contracts, specs, proof, review, acceptance criteria, or a
  structured plan;
- work is multi-file, ambiguous, long-running, or risky;
- the task touches auth, billing, migrations, public APIs, tests, production
  config, data, security, permissions, or deploy behavior;
- you would otherwise proceed on a material assumption;
- you are about to claim the work is complete.

Do not log every trivial inference. An assumption is material when changing it
would affect user-visible behavior, data model, permissions, billing, public API
shape, migrations/backfills/data loss, test strategy, architecture boundaries,
deployment/configuration, file scope, or the definition of done.

## Core Workflow

1. Call `create-contract` with the goal, source, repo path, and initial
   assumptions/criteria before risky implementation.
2. Surface the returned Contracts UI link or inline MCP App. In CLI hosts, tell
   the user to open the link and review the queue.
3. Call `get-feedback` before risky edits, after review, after any long pause,
   and before the final response.
4. If the user accepts, rejects, corrects, or requests evidence, consume the
   structured feedback and change your plan accordingly.
5. If new facts require a change after approval, create an `amendment` or
   `deviation` item with `upsert-contract-items` instead of drifting silently.
6. Attach command/test/log/diff/screenshot evidence with `record-evidence`.
7. Do not treat your own claim as proof. Agent attestation is low trust.
   Criteria are done only when verified by human, CI, deterministic checks, or
   an independent verifier.
8. Export a JSON/Markdown receipt with `export-contract` when the user wants a
   shareable summary.

## Tool Guidance

- `create-contract`: start one contract per agent task/run.
- `upsert-contract-items`: bulk add/update assumptions, decisions, criteria,
  risks, deviations, open questions, and amendments.
- `get-contract` and `get-review-queue`: read current structured state.
- `get-feedback`: read unconsumed human feedback. Use it frequently.
- `record-progress`: update phase/status and mark feedback consumed only after
  you incorporated it.
- `record-evidence`: attach artifacts and provenance. Use high trust for
  captured commands/tests/CI, human_confirmed for explicit human confirmation,
  and low trust for agent-only statements.
- `analyze-plan`: import pasted plan text and let Contracts create possible
  assumptions/criteria. Treat detections as possible, not authoritative.

## Guardrails

- Before high-risk actions, create a blocking review item or ask the user
  directly.
- Never modify tests merely to make implementation pass unless the contract
  explicitly approves test expectation changes.
- If proof is missing, say so. Do not call the task complete just because code
  was changed.
- If evidence contains secrets or tokens, rely on Contracts redaction and avoid
  pasting raw output into chat.
- Do not hand-roll MCP HTTP requests with curl. Use host-exposed tools after
  restart/reload, or use the returned browser/deep-link fallback.
- Do not put shared secrets in skill files. Auth belongs in the MCP host.
