/**
 * Canonical "built-in agent-native app -> MCP server" descriptor registry.
 *
 * This is a dependency-free mirror of the manifest data encoded in
 * `@agent-native/core`'s `BUILT_IN_APP_SKILLS` object
 * (`packages/core/src/cli/skills.ts`, around line 1711+). The standalone
 * `@agent-native/skills` installer uses this to know which skill name maps to
 * which hosted MCP server without importing the (much heavier) core CLI module.
 *
 * IMPORTANT: every URL / serverName / alias / authMode below MUST stay byte-for-byte
 * identical to core's `BUILT_IN_APP_SKILLS`. The provenance of each value is noted
 * inline as `packages/core/src/cli/skills.ts:<line>`. If core changes, update here too
 * (a future sync guard test should compare the two).
 */

/** Auth modes mirrored from core's `auth.mode` on each app-skill manifest. */
export type BuiltInAppAuthMode = "oauth" | "device" | "none";

/**
 * Descriptor for a single built-in agent-native app and the hosted MCP server
 * its skills connect to.
 */
export interface BuiltInAppMcp {
  /** Stable app id (matches the manifest `id` in core). */
  appId: string;
  /** Human-facing display name. */
  displayName: string;
  /** Skill names this app exports (a skill name resolves back to this app). */
  skillNames: string[];
  /** MCP server name used when registering the connector. */
  serverName: string;
  /** Hosted MCP endpoint URL (`hosted.mcpUrl`). */
  mcpUrl: string;
  /** Hosted app base URL (`hosted.url`). */
  hostedUrl: string;
  /** Alternate server names accepted for this app (`mcp.aliases`). */
  aliases?: string[];
  /** Auth mode for connecting the MCP server (`auth.mode`). */
  authMode: BuiltInAppAuthMode;
  /** True when the app ships only as a local command (no remote refresh). */
  localOnly?: boolean;
  /** True when the app provides a PR Visual Recap GitHub Action workflow. */
  hasGithubAction?: boolean;
}

/**
 * The built-in app -> MCP registry.
 *
 * Each entry's values are copied verbatim from core. Provenance per field is
 * cited inline using the `packages/core/src/cli/skills.ts` line numbers.
 */
export const BUILT_IN_APP_MCP: BuiltInAppMcp[] = [
  {
    // core skills.ts:1822 (id), :1823 (displayName)
    appId: "visual-plans",
    displayName: "Agent-Native Plan",
    // core skills.ts:1803 (skillName "visual-plan") + :1805 (extraSkills "visual-recap")
    skillNames: ["visual-plan", "visual-recap"],
    // core skills.ts:1830 (mcp.serverName + mcp.aliases)
    serverName: "plan",
    aliases: ["agent-native-plans"],
    // core skills.ts:1828 (hosted.mcpUrl)
    mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
    // core skills.ts:1827 (hosted.url)
    hostedUrl: "https://plan.agent-native.com",
    // core skills.ts:1832 (auth.mode)
    authMode: "oauth",
    // core skills.ts:3321-3322 (githubActionPath gated on knownTarget === "visual-plans")
    hasGithubAction: true,
  },
  {
    // core skills.ts:1716 (id), :1717 (displayName)
    appId: "assets",
    displayName: "Assets",
    // core skills.ts:1713 (skillName)
    skillNames: ["assets"],
    // core skills.ts:1724 (mcp.serverName)
    serverName: "agent-native-assets",
    // core skills.ts:1722 (hosted.mcpUrl)
    mcpUrl: "https://assets.agent-native.com/_agent-native/mcp",
    // core skills.ts:1721 (hosted.url)
    hostedUrl: "https://assets.agent-native.com",
    // core skills.ts:1726 (auth.mode)
    authMode: "oauth",
  },
  {
    // core skills.ts:1762 (id), :1763 (displayName)
    appId: "design",
    displayName: "Design",
    // core skills.ts:1759 (skillName)
    skillNames: ["design-exploration"],
    // core skills.ts:1770 (mcp.serverName)
    serverName: "agent-native-design",
    // core skills.ts:1768 (hosted.mcpUrl)
    mcpUrl: "https://design.agent-native.com/_agent-native/mcp",
    // core skills.ts:1767 (hosted.url)
    hostedUrl: "https://design.agent-native.com",
    // core skills.ts:1772 (auth.mode)
    authMode: "oauth",
  },
  {
    // core skills.ts:1881 (id), :1882 (displayName)
    appId: "context-xray",
    displayName: "Context X-Ray",
    // core skills.ts:1877 (skillName)
    skillNames: ["context-xray"],
    // core skills.ts:1889 (mcp.serverName)
    serverName: "agent-native-context-xray",
    // core skills.ts:1887 (hosted.mcpUrl)
    mcpUrl: "https://context-xray.agent-native.com/_agent-native/mcp",
    // core skills.ts:1886 (hosted.url)
    hostedUrl: "https://context-xray.agent-native.com",
    // core skills.ts:1890 (auth.mode)
    authMode: "none",
    // core skills.ts:1878 (localOnly: true)
    localOnly: true,
  },
];

/**
 * Resolve the built-in app whose `skillNames` contains `skillName`
 * (case-insensitive). Returns `undefined` when no built-in app exports it.
 */
export function resolveAppForSkill(
  skillName: string,
): BuiltInAppMcp | undefined {
  const needle = skillName.trim().toLowerCase();
  if (!needle) return undefined;
  return BUILT_IN_APP_MCP.find((app) =>
    app.skillNames.some((name) => name.toLowerCase() === needle),
  );
}

/**
 * True when the given skill name maps to a built-in app with a hosted MCP
 * server.
 */
export function appHasMcp(skillName: string): boolean {
  return resolveAppForSkill(skillName) !== undefined;
}
