# Agent-Native Code — Agent Guide

Agent-Native Code is the local coding-agent surface. It manages local runs,
streaming, run state, and code-agent UI through the framework where possible.

## Core Rules

- Use the existing local Code run store and code-agent adapter/foundation. Do not
  introduce a second background-agent harness.
- Preserve streaming, aborts, resume, heartbeats, and persisted run state.
- Use actions for run lifecycle, UI commands, and state changes where available.
- Keep prompt input surfaces on the shared composer stack unless working on the
  narrow host-specific slots around it.
- Use `view-screen` when the active run, workspace, terminal, or file context is
  unclear.

## Application State

- `navigation` exposes current workspace, run, panel, terminal, and selection
  context.
- `navigate` moves the UI between workspaces, runs, files, and settings.

## Skills

Use root skills: `actions`, `delegate-to-agent`, `self-modifying-code`,
`real-time-sync`, `security`, `frontend-design`, `shadcn-ui`, and the code-agent
run-manager guidance in root instructions.
