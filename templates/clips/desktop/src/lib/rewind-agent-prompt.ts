export const REWIND_AGENT_PROMPT = `Set up Agent Native Rewind for this agent once so I can later say things like “Look at Rewind” or “What did I just say?” without pasting setup instructions again.

Install or refresh the public Rewind skill and its local Clips Screen Memory MCP connection with:

\`npx -y @agent-native/core@latest skills add rewind --client <client> --scope user --yes\`

Replace \`<client>\` with the compatible host you are running in: \`codex\`, \`claude-code\`, \`cursor\`, \`opencode\`, \`github-copilot\`, or \`cowork\`. Run the command yourself if you have shell access. Ask me to restart the host only if it cannot reload MCP servers in place, then verify the connection with \`screen_memory_status\`.

If this host cannot install skills or MCP servers, explain that limitation clearly. For this request only, use any already-configured Screen Memory tools with the same local-first boundaries: search chapters before raw context, read the smallest relevant range, flag uncertainty, inspect local frames before escalation, never crawl Clips' archive paths, and request a bounded private Clip only when local evidence is insufficient.`;
