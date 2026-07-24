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
- If the Screen Memory MCP is missing, explain that the one-time setup needs to
  be repaired with:

  \`npx -y @agent-native/core@latest skills add rewind --client <client> --scope user --yes\`

  Replace \`<client>\` with the current compatible host: \`codex\`,
  \`claude-code\`, \`cursor\`, \`opencode\`, \`github-copilot\`, or \`cowork\`.
  Ask the user to restart the host if it cannot reload MCP servers in place.
`;
