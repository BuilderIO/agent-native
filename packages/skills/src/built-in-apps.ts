
export type BuiltInAppAuthMode = "oauth" | "device" | "none";

export interface BuiltInAppMcp {
  appId: string;
  displayName: string;
  skillNames: string[];
  serverName: string;
  mcpUrl: string;
  hostedUrl: string;
  aliases?: string[];
  authMode: BuiltInAppAuthMode;
  localOnly?: boolean;
  hasGithubAction?: boolean;
}

export const BUILT_IN_APP_MCP: BuiltInAppMcp[] = [
  {
    appId: "visual-plans",
    displayName: "Agent-Native Plan",
    skillNames: ["visual-plan", "visual-recap", "visualize-repo"],
    serverName: "plan",
    aliases: ["agent-native-plans"],
    mcpUrl: "https://plan.agent-native.com/mcp",
    hostedUrl: "https://plan.agent-native.com",
    authMode: "oauth",
    hasGithubAction: true,
  },
  {
    appId: "assets",
    displayName: "Assets",
    skillNames: ["assets"],
    serverName: "agent-native-assets",
    mcpUrl: "https://assets.agent-native.com/mcp",
    hostedUrl: "https://assets.agent-native.com",
    authMode: "oauth",
  },
  {
    appId: "content",
    displayName: "Content",
    skillNames: ["content"],
    serverName: "agent-native-content",
    mcpUrl: "https://content.agent-native.com/mcp",
    hostedUrl: "https://content.agent-native.com",
    authMode: "oauth",
  },
  {
    appId: "design",
    displayName: "Design",
    skillNames: ["design-exploration", "visual-edit"],
    serverName: "agent-native-design",
    mcpUrl: "https://design.agent-native.com/mcp",
    hostedUrl: "https://design.agent-native.com",
    authMode: "oauth",
  },
  {
    appId: "context-xray",
    displayName: "Context X-Ray",
    skillNames: ["context-xray"],
    serverName: "agent-native-context-xray",
    mcpUrl: "https://context-xray.agent-native.com/mcp",
    hostedUrl: "https://context-xray.agent-native.com",
    authMode: "none",
    localOnly: true,
  },
];

export function resolveAppForSkill(
  skillName: string,
): BuiltInAppMcp | undefined {
  const needle = skillName.trim().toLowerCase();
  if (!needle) return undefined;
  return BUILT_IN_APP_MCP.find((app) =>
    app.skillNames.some((name) => name.toLowerCase() === needle),
  );
}

export function appHasMcp(skillName: string): boolean {
  return resolveAppForSkill(skillName) !== undefined;
}
