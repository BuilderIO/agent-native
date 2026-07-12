# Macros — Agent Guide

Macros is an agent-native voice and nutrition tracking app. The agent works with
foods, meals, calories/macros, voice corrections, stats, and navigation through
actions and SQL state.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for meals, foods, calorie/macro updates, voice command handling,
  stats, and navigation. Do not mutate app tables directly.
- Do not invent nutrition values when the source is unknown. Ask, use defaults
  transparently, or mark estimates.
- Voice transcription can contain common food/name mistakes; confirm ambiguous
  entries before destructive changes.
- Use `view-screen` when the active meal, day, food, or stats context is unclear.
- Keep health/nutrition guidance non-medical and focused on tracking data.

## Application State

- `navigation` exposes current day, meal, food entry, stats, and settings view.
- `navigate` moves the UI to log, meals, stats, and settings.

## Skills

Read `update-calories` before changing calorie/macro behavior. Use `actions`,
`storing-data`, `security`, `frontend-design`, and `shadcn-ui` for framework
work.
