import {
  AGENT_ACCESS_PARAM,
  buildAgentAccessApiUrl,
  buildAgentAccessUrl,
  toAgentAccessUrl,
  type AgentAccessUrlOptions,
} from "./agent-access.js";

export const AGENT_READABLE_RESOURCE_SCRIPT_TYPE =
  "application/agent-native+json";
export const AGENT_READABLE_RESOURCE_PAYLOAD_TYPE =
  "agent-native.resource.discovery";

export interface AgentReadableResourceDiscovery {
  type: typeof AGENT_READABLE_RESOURCE_PAYLOAD_TYPE;
  resourceType: string;
  resourceId: string;
  title?: string;
  url?: string;
  contextUrl: string;
  expiresAt?: string;
  instructions?: string;
}

export interface BuildAgentReadableResourceDiscoveryOptions extends AgentAccessUrlOptions {
  resourceType: string;
  resourceId: string;
  title?: string | null;
  path?: string | null;
  contextEndpoint: string;
  token?: string | null;
  expiresAt?: string | null;
  instructions?: string | null;
}

export function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return char;
    }
  });
}

export function buildAgentReadableResourceDiscovery({
  resourceType,
  resourceId,
  title,
  path,
  contextEndpoint,
  token,
  expiresAt,
  instructions,
  origin,
  basePath,
  tokenParam = AGENT_ACCESS_PARAM,
}: BuildAgentReadableResourceDiscoveryOptions): AgentReadableResourceDiscovery {
  return {
    type: AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
    resourceType,
    resourceId,
    ...(title ? { title } : {}),
    ...(path
      ? {
          url: token
            ? buildAgentAccessUrl({
                path,
                token,
                origin,
                basePath,
                tokenParam,
              })
            : toAgentAccessUrl(path, { origin, basePath }),
        }
      : {}),
    contextUrl: buildAgentAccessApiUrl({
      endpoint: contextEndpoint,
      resourceId,
      token,
      origin,
      basePath,
      tokenParam,
    }),
    ...(expiresAt ? { expiresAt } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

export function renderAgentReadableResourceDiscoveryScript(
  discovery: AgentReadableResourceDiscovery,
  options: { id?: string } = {},
): string {
  const id = options.id ? ` id="${escapeHtmlAttribute(options.id)}"` : "";
  return `<script type="${AGENT_READABLE_RESOURCE_SCRIPT_TYPE}"${id}>${safeJsonForHtml(
    discovery,
  )}</script>`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&"]/g, (char) => (char === "&" ? "&amp;" : "&quot;"));
}
