import { z } from "zod";

export const workspaceConfig = z.object({
  isWorkspace: z
    .boolean()
    .optional()
    .meta({
      env: ["AGENT_NATIVE_WORKSPACE", "VITE_AGENT_NATIVE_WORKSPACE"],
      doc: "Whether this app is mounted inside a shared workspace gateway.",
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
  gatewayUrl: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: ["WORKSPACE_GATEWAY_URL", "VITE_WORKSPACE_GATEWAY_URL"],
      doc: "URL of the workspace gateway fronting this app.",
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
