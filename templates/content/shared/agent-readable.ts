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
export const DOCUMENT_AGENT_READABLE_INSTRUCTIONS =
  "Use contextUrl for public or agent-token JSON. For a private document, first use an existing authenticated Content MCP connection and call get-document with id; the host may prefix the tool name. Only if no Content connection exists, open mcpConnectUrl and authenticate, then retry. Do not ask the user to paste the document before trying MCP.";

export interface ContentDocumentMcpGuidance {
  preferredTransport: "mcp";
  mcpUrl: string;
  mcpConnectUrl: string;
  readAction: {
    name: typeof CONTENT_DOCUMENT_READ_ACTION;
    arguments: { id: string };
  };
  instructions: string;
}

export function buildContentDocumentMcpGuidance(
  documentId: string,
  options: { basePath?: string } = {},
): ContentDocumentMcpGuidance {
  const basePath = normalizeAgentAccessBasePath(options.basePath);
  return {
    preferredTransport: "mcp",
    mcpUrl: toAgentAccessUrl(CONTENT_MCP_ENDPOINT, { basePath }),
    mcpConnectUrl: toAgentAccessUrl(CONTENT_MCP_CONNECT_ENDPOINT, { basePath }),
    readAction: {
      name: CONTENT_DOCUMENT_READ_ACTION,
      arguments: { id: documentId },
    },
    instructions: DOCUMENT_AGENT_READABLE_INSTRUCTIONS,
  };
}

export function contentDocumentMcpInstructionText(
  documentId: string,
  options: { basePath?: string } = {},
): string {
  const guidance = buildContentDocumentMcpGuidance(documentId, options);
  return `Agent access: use an existing authenticated Content MCP connection at ${guidance.mcpUrl} and call ${guidance.readAction.name} with id ${JSON.stringify(documentId)}. Your host may prefix the tool name. If no Content MCP connection exists, open ${guidance.mcpConnectUrl}, authenticate, and retry. Do not ask the user to paste the document before trying MCP.`;
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
}: {
  document: { id: string; title?: string };
  token?: string | null;
  basePath?: string;
}): AgentReadableResourceDiscovery & ContentDocumentMcpGuidance {
  const discovery = buildAgentReadableResourceDiscovery({
    resourceType: "document",
    resourceId: document.id,
    title: document.title,
    path: buildContentPublicDocumentPath(document.id),
    contextEndpoint: DOCUMENT_AGENT_CONTEXT_ENDPOINT,
    token,
    basePath,
    instructions: DOCUMENT_AGENT_READABLE_INSTRUCTIONS,
  });
  return {
    ...discovery,
    ...buildContentDocumentMcpGuidance(document.id, { basePath }),
  };
}
