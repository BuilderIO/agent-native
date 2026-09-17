import {
  AGENT_ACCESS_PARAM,
  buildAgentAccessUrl,
  buildAgentReadableResourceDiscovery,
  normalizeAgentAccessBasePath,
  toAgentAccessUrl,
  type AgentReadableResourceDiscovery,
} from "@agent-native/core/shared";

export const DOCUMENT_AGENT_RESOURCE_KIND = "content:document";
export const DOCUMENT_AGENT_CONTEXT_ENDPOINT =
  "/api/document-agent-context.json";
export const CONTENT_MCP_ENDPOINT = "/mcp";
export const CONTENT_MCP_CONNECT_ENDPOINT = "/mcp/connect";
export const CONTENT_DOCUMENT_READ_ACTION = "get-document";
export const CONTENT_MCP_PROHIBITED_FALLBACKS = [
  "ask-user-to-paste-document",
  "ask-user-to-make-document-public",
  "ask-user-to-change-sharing",
] as const;

function absoluteAgentAccessUrl(path: string, origin?: string): string {
  return origin ? new URL(path, origin).toString() : path;
}

function missingContentMcpMessage(connectionUrl: string): string {
  return `This private Content document requires the Content MCP server. Connect it at ${connectionUrl}, authenticate, then ask me to retry.`;
}

export interface ContentDocumentMcpGuidance {
  preferredTransport: "mcp";
  mcpUrl: string;
  mcpConnectUrl: string;
  readAction: {
    name: typeof CONTENT_DOCUMENT_READ_ACTION;
    arguments: { id: string };
  };
  whenToolUnavailable: {
    action: "tell-user-to-connect";
    connectionUrl: string;
    message: string;
  };
  prohibitedFallbacks: typeof CONTENT_MCP_PROHIBITED_FALLBACKS;
  instructions: string;
}

export function buildContentDocumentMcpGuidance(
  documentId: string,
  options: { basePath?: string; origin?: string } = {},
): ContentDocumentMcpGuidance {
  const basePath = normalizeAgentAccessBasePath(options.basePath);
  const mcpUrl = absoluteAgentAccessUrl(
    toAgentAccessUrl(CONTENT_MCP_ENDPOINT, { basePath }),
    options.origin,
  );
  const mcpConnectUrl = absoluteAgentAccessUrl(
    toAgentAccessUrl(CONTENT_MCP_CONNECT_ENDPOINT, { basePath }),
    options.origin,
  );
  const message = missingContentMcpMessage(mcpConnectUrl);
  return {
    preferredTransport: "mcp",
    mcpUrl,
    mcpConnectUrl,
    readAction: {
      name: CONTENT_DOCUMENT_READ_ACTION,
      arguments: { id: documentId },
    },
    whenToolUnavailable: {
      action: "tell-user-to-connect",
      connectionUrl: mcpConnectUrl,
      message,
    },
    prohibitedFallbacks: CONTENT_MCP_PROHIBITED_FALLBACKS,
    instructions: `Use contextUrl first. If it reports that the document is private, use an authenticated Content MCP tool and call get-document with id; the host may prefix the tool name. If no Content MCP tool is available, tell the user exactly: ${JSON.stringify(message)} Do not ask the user to paste the document, make it public, or change sharing permissions.`,
  };
}

export function contentDocumentMcpInstructionText(
  documentId: string,
  options: { basePath?: string; origin?: string } = {},
): string {
  const guidance = buildContentDocumentMcpGuidance(documentId, options);
  return `Agent access: if an authenticated Content MCP tool is available, call ${guidance.readAction.name} with id ${JSON.stringify(documentId)}. If no Content MCP tool is available, tell the user exactly: ${JSON.stringify(guidance.whenToolUnavailable.message)} Do not ask the user to paste the document, make it public, or change sharing permissions.`;
}

export function buildContentPublicDocumentPath(documentId: string): string {
  return `/p/${documentId}`;
}

export function buildContentPublicDocumentUrl(
  documentId: string,
  options: { basePath?: string; token?: string | null } = {},
): string {
  const path = buildContentPublicDocumentPath(documentId);
  const basePath = normalizeAgentAccessBasePath(options.basePath);
  if (options.token) {
    return buildAgentAccessUrl({
      path,
      basePath,
      token: options.token,
      tokenParam: AGENT_ACCESS_PARAM,
    });
  }
  return toAgentAccessUrl(path, { basePath });
}

export function buildContentDocumentAgentDiscovery({
  document,
  token,
  basePath,
  origin,
}: {
  document: { id: string; title?: string };
  token?: string | null;
  basePath?: string;
  origin?: string;
}): AgentReadableResourceDiscovery & ContentDocumentMcpGuidance {
  const discovery = buildAgentReadableResourceDiscovery({
    resourceType: "document",
    resourceId: document.id,
    title: document.title,
    path: buildContentPublicDocumentPath(document.id),
    contextEndpoint: DOCUMENT_AGENT_CONTEXT_ENDPOINT,
    token,
    basePath,
    instructions: buildContentDocumentMcpGuidance(document.id, {
      basePath,
      origin,
    }).instructions,
  });
  return {
    ...discovery,
    ...buildContentDocumentMcpGuidance(document.id, { basePath, origin }),
  };
}
