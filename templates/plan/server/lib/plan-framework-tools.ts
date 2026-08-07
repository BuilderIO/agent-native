import type { FrameworkToolsConfig } from "@agent-native/core/server";

/**
 * Framework tool policy shared by Plan's two mounts.
 *
 * Plan serves MCP from a dedicated early plugin (`plugins/00-mcp.ts`) rather
 * than the agent-chat plugin, so the policy has to live somewhere both can
 * read. Setting it in only one place is how an app ends up advertising a tool
 * over MCP that its own agent no longer has.
 */
export const PLAN_FRAMEWORK_TOOLS: FrameworkToolsConfig = {};
