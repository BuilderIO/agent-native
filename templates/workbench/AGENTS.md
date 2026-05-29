# Workbench — Agent Guide

Workbench is an agent-native workspace for rooms, connected resources, shared
integrations, and collaboration surfaces.

## Core Rules

- Use actions and shared workspace integration grants for rooms, connections,
  resources, and navigation. Do not copy provider credentials into Workbench.
- Treat rooms as ownable collaborative resources; preserve access checks on every
  read and write.
- Use `view-screen` when the active room, connection, resource, or selection is
  unclear.
- Keep room UI focused on the primary collaborative object and hide secondary
  setup behind progressive disclosure.

## Application State

- `navigation` exposes room, resource, connection, panel, and selection context.
- `navigate` moves the UI to rooms, resources, connections, and settings.

## Skills

This template has no dedicated local skills yet. Use root skills: `actions`,
`sharing`, `secrets`, `external-agents`, `storing-data`, `real-time-sync`,
`security`, `frontend-design`, and `shadcn-ui`.
