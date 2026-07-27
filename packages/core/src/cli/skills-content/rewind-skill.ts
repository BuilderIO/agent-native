export const REWIND_SKILL_MD = `---
name: rewind
description: >-
  Retrieve recent local Clips Rewind context when the user says "Look at
  Rewind," asks what just happened, or refers to something they recently said
  or saw.
metadata:
  visibility: exported
---

# Rewind

Use Clips Rewind as local screen memory. Start broad enough to find the right
moment, then read only the smallest relevant range.

## First-Run Setup

Call \`screen_memory_status\` before assuming Rewind is ready. If the tool is
unavailable, do not stop at a missing-tool error and do not silently install
anything:

1. Explain that Rewind requires the signed Clips Desktop app on macOS plus a
   local agent connection.
2. Ask whether Clips is installed, or use a non-mutating native application
   lookup when the host supports one. Do not inspect Clips' app-data folders.
   If Clips is absent or its presence cannot be confirmed, ask permission
   before opening or downloading anything: “Clips Desktop is required for
   Rewind. Would you like me to open the official installer and guide you
   through setup?”
3. Only after affirmative permission, open
   \`https://clips.agent-native.com/download\` in the user's browser. Complete
   native installation steps only when the current host can safely do so and
   the user explicitly permitted them. Never bypass Gatekeeper, accept macOS
   permission prompts, or enable screen/audio capture on the user's behalf.
4. If native UI control is unavailable, return the download link and wait for
   the user to confirm that Clips is installed and running.
5. Ask the user to enable Rewind in the Clips tray and choose the intended
   capture mode. Then configure the local connection with:

   \`npx -y @agent-native/core@latest skills add rewind --client <client> --scope user --yes\`

   Replace \`<client>\` with the current compatible host: \`codex\`,
   \`claude-code\`, \`cursor\`, \`opencode\`, \`github-copilot\`, or \`cowork\`.
6. Restart the host only if it cannot reload MCP servers in place, then retry
   \`screen_memory_status\`. Do not claim setup succeeded until it reports
   Rewind enabled and unpaused.

## Retrieval Flow

1. Call \`screen_memory_status\` first. If the newest segment is still open,
   wait for it to finalize rather than substituting an older segment.
2. Search \`screen_memory_search_chapters\` before requesting raw recent
   context. Use the user's words, the visible app or project, and the likely
   time range as clues.
3. If several chapters plausibly match, show the candidates and ask which one
   the user means. Do not blend separate workstreams together.
4. Read the smallest useful range with \`screen_memory_recent_context\`.
   Restate what you recovered before acting, and flag transcription or coverage
   uncertainty.
5. Use \`screen_memory_frame_at\` for one exact visual moment or
   \`screen_memory_contact_sheet\` to scan a bounded range. Prefer local frames
   before escalating to cloud processing.
6. Request the smallest relevant timestamp range through Clips' bounded private
   Clip handoff only when local text and frames are insufficient, such as
   garbled speech, important motion, dense analysis, or a Clip the user wants
   to keep and query later.

## Boundaries

- Rewind recordings, screenshots, audio, transcripts, OCR, and indexes remain
  local unless the user explicitly asks for a bounded Clip handoff.
- Do not reveal archive filesystem paths, crawl Clips' app-data folders, or
  bypass the Screen Memory MCP broker.
- Do not upload frames returned by local Screen Memory tools.
- Treat foreground apps and chapter labels as evidence, not proof of intent.
- If Clips is installed and Rewind is enabled but the Screen Memory MCP is
  missing, explain that only the agent connection needs repair with:

  \`npx -y @agent-native/core@latest skills add rewind --client <client> --scope user --yes\`

  Ask the user to restart the host if it cannot reload MCP servers in place.
- Never conflate installing Clips Desktop with installing the skill/MCP
  connection, and never claim either succeeded without direct evidence.
`;
