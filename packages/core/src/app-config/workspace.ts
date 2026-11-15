import { z } from "zod";

export const workspaceConfig = z.object({
  isWorkspace: z
    .boolean()
    .optional()
    .meta({
      env: ["AGENT_NATIVE_WORKSPACE", "VITE_AGENT_NATIVE_WORKSPACE"],
      doc: "Whether this app is mounted inside a shared workspace gateway.",
    }),
  inlineCommonChunks: z.boolean().optional().meta({
    env: "AGENT_NATIVE_INLINE_WORKSPACE_CHUNKS",
    doc: "Inline small shared client chunks in workspace builds; requires a compatible bundler.",
  }),
  authMode: z
    .enum(["shared", "isolated"])
    .optional()
    .meta({
      env: [
        "AGENT_NATIVE_WORKSPACE_AUTH_MODE",
        "VITE_AGENT_NATIVE_WORKSPACE_AUTH_MODE",
      ],
      doc: "Whether mounted workspace apps share auth or keep per-app sessions.",
    }),
  appsJson: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: [
        "AGENT_NATIVE_WORKSPACE_APPS_JSON",
        "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      ],
      doc: "Serialized workspace app manifest used by mounted app runtimes.",
    }),
  builtinAgentsJson: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_NATIVE_BUILTIN_AGENTS_JSON"],
      doc: "Serialized agent-native.builtinAgents config passed to workspace app runtimes.",
    }),
  gatewayUrl: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["WORKSPACE_GATEWAY_URL", "VITE_WORKSPACE_GATEWAY_URL"],
      doc: "URL of the workspace gateway fronting this app.",
    }),
  appAccessStore: z
    .enum(["auto", "database"])
    .optional()
    .meta({
      env: ["AGENT_NATIVE_WORKSPACE_APP_ACCESS_STORE"],
      doc: "Use database for app authorization only when every shared-auth workspace app uses the same authoritative database. Auto uses the configured Dispatch directory when available. Other directory services remain unchanged.",
    }),
  orgDirectoryUrl: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["AGENT_NATIVE_ORG_DIRECTORY_URL"],
      doc: "URL of the authoritative organization Dispatch directory.",
    }),
  oauthOrigin: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["WORKSPACE_OAUTH_ORIGIN", "VITE_WORKSPACE_OAUTH_ORIGIN"],
      doc: "Shared origin workspace apps complete OAuth against.",
    }),
});
