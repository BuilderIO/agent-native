export const REWIND_AGENT_PROMPT = `I just told you something in Clips Rewind. Retrieve the newest relevant local Rewind context, restate what you recovered, and then carry out my request.

Use the configured Clips Screen Memory MCP. If it is missing, install or repair it for your current MCP client with \`npx -y @agent-native/core@latest mcp install-screen-memory --client <client>\`, then ask me to restart the agent if the client cannot reload MCP servers in place. Do not bypass Clips by crawling its local archive or app-data directory.

Call screen_memory_status first. Search screen_memory_search_chapters before requesting raw recent context, using the smallest useful time window. If several chapters plausibly match, show me the candidates and ask which one I mean instead of blending separate work together.

Use screen_memory_frame_at for one exact visual moment, or screen_memory_contact_sheet to scan a bounded range. These are local reads: do not reveal archive paths and do not upload the returned frames. Flag transcription uncertainty. Only request the smallest relevant timestamp range through Clips' bounded private Clip handoff when local text and frames are insufficient—for example, garbled speech, motion, dense cloud analysis, or a Clip I can keep and query later.`;
