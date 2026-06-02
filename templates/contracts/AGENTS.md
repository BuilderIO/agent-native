# Contracts — Agent Guide

Contracts is a local-first review and proof layer for coding agents. Its job is
to show material assumptions, collect structured human feedback, and require
evidence before an agent can call work done.

## Core Rules

- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Use actions for app operations and keep frontend/API parity.
- Keep database code provider-agnostic and additive.
- Use `view-screen` or application state when the active page/selection is
  unclear.
- For new features, update UI, actions, skills/instructions, and application
  state when applicable.
- Do not treat agent claims as proof. Evidence and verification are separate.
- Surface material assumptions only. Avoid filling the ledger with trivial
  implementation inferences.
- Before risky edits, read pending feedback with `get-feedback`.

## Application State

- `navigation.view` is `contracts`, `contract`, `extensions`, or `team`.
- `navigation.contractId` identifies the active contract when present.
- `navigate` moves the UI to the review inbox or a specific contract.

## Skills

Use `.agents/skills/contracts/SKILL.md` for contract review behavior.
Read the relevant root skill before implementation: `adding-a-feature`,
`actions`, `storing-data`, `real-time-sync`, `security`, `delegate-to-agent`,
`frontend-design`, `shadcn-ui`, and `self-modifying-code`.
