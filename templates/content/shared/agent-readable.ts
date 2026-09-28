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
export const CONTENT_MCP_SETUP_DOCUMENTATION_URL =
  "https://www.agent-native.com/docs/external-agents/#private-content-links" as const;

export type ContentDocumentAccessState =
  | "public"
  | "authorized"
  | "authentication-required";

function absoluteAgentAccessUrl(path: string, origin?: string): string {
  return origin ? new URL(path, origin).toString() : path;
}

function contentDocumentAccessSummary(
  accessState: ContentDocumentAccessState,
): string {
  if (accessState === "public") {
    return "This document is available through its public Content share page.";
  }
  if (accessState === "authorized") {
    return "This private document is available through this authorized Content share page.";
  }
  return "This Content document is private. Authenticated access is available through the Content MCP integration.";
}

export interface ContentDocumentMcpGuidance {
  accessContractVersion: 2;
  preferredTransport: "mcp";
  mcpUrl: string;
  mcpConnectUrl: string;
  readAction: {
    name: typeof CONTENT_DOCUMENT_READ_ACTION;
    arguments: { id: string };
  };
  access: {
    state: ContentDocumentAccessState;
    summary: string;
    sharePageAuthenticationRequired: boolean;
    sharePageHttpAccess: "readable" | "authorized" | "denied";
    sharePageAuthorization: "public" | "scoped-token" | "none";
    mcpActionAuthenticationRequired: true;
    mcpConnectionRequiredForPageAccess: boolean;
    mcpAccountPermission: "not-required" | "not-evaluated";
    mcpAuthorization: "connected-account-existing-permissions";
    setupDocumentationUrl: typeof CONTENT_MCP_SETUP_DOCUMENTATION_URL;
    connectionUrl: string;
    missingMcpConnectionPath:
      | "not-required"
      | "add-remote-server-authenticate-enable-and-retry";
  };
  instructions: string;
}

export function buildContentDocumentMcpGuidance(
  documentId: string,
  options: {
    basePath?: string;
    origin?: string;
    accessState?: ContentDocumentAccessState;
  } = {},
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
  const accessState = options.accessState ?? "authentication-required";
  const summary = contentDocumentAccessSummary(accessState);
  const access: ContentDocumentMcpGuidance["access"] = {
    state: accessState,
    summary,
    sharePageAuthenticationRequired: accessState === "authentication-required",
    sharePageHttpAccess:
      accessState === "public"
        ? "readable"
        : accessState === "authorized"
          ? "authorized"
          : "denied",
    sharePageAuthorization:
      accessState === "public"
        ? "public"
        : accessState === "authorized"
          ? "scoped-token"
          : "none",
    mcpActionAuthenticationRequired: true,
    mcpAccountPermission:
      accessState === "public" ? "not-required" : "not-evaluated",
    mcpConnectionRequiredForPageAccess:
      accessState === "authentication-required",
    mcpAuthorization: "connected-account-existing-permissions" as const,
    setupDocumentationUrl: CONTENT_MCP_SETUP_DOCUMENTATION_URL,
    connectionUrl: mcpConnectUrl,
    missingMcpConnectionPath:
      accessState === "authentication-required"
        ? "add-remote-server-authenticate-enable-and-retry"
        : "not-required",
  };
  return {
    accessContractVersion: 2,
    preferredTransport: "mcp",
    mcpUrl,
    mcpConnectUrl,
    readAction: {
      name: CONTENT_DOCUMENT_READ_ACTION,
      arguments: { id: documentId },
    },
    access,
    instructions: contentDocumentMcpInstructionText(documentId, {
      basePath,
      origin: options.origin,
      accessState,
    }),
  };
}

export function contentDocumentMcpInstructionText(
  documentId: string,
  options: {
    basePath?: string;
    origin?: string;
    accessState?: ContentDocumentAccessState;
  } = {},
): string {
  const basePath = normalizeAgentAccessBasePath(options.basePath);
  const mcpUrl = absoluteAgentAccessUrl(
    toAgentAccessUrl(CONTENT_MCP_ENDPOINT, { basePath }),
    options.origin,
  );
  const mcpConnectUrl = absoluteAgentAccessUrl(
    toAgentAccessUrl(CONTENT_MCP_CONNECT_ENDPOINT, { basePath }),
    options.origin,
  );
  const summary = contentDocumentAccessSummary(
    options.accessState ?? "authentication-required",
  );
  if (
    options.accessState === "authentication-required" ||
    !options.accessState
  ) {
    return `Agent-Native Content access record. Resource: private Content document. Anonymous HTTP access: denied. Authenticated Content MCP endpoint: ${mcpUrl}. Connection page: ${mcpConnectUrl}. Official Agent-Native setup documentation: ${CONTENT_MCP_SETUP_DOCUMENTATION_URL}. Content MCP read action: ${CONTENT_DOCUMENT_READ_ACTION}. Document id: ${JSON.stringify(documentId)}. Adding a connection changes the user's agent configuration and is the user's choice. Authentication uses the connected account's existing document permissions and does not grant new document access. The connected account's permission for this document has not been evaluated.`;
  }
  const mcpPermissionFacts =
    options.accessState === "public"
      ? " This public share page does not require an MCP account permission."
      : options.accessState === "authorized"
        ? " This page is authorized by its scoped share token. MCP access separately uses the connected account's existing document permissions."
        : " Document access through MCP uses the connected account's existing permissions.";
  return `Content access information: ${summary}${mcpPermissionFacts} Content MCP server: ${mcpUrl}. Connection setup for this Content instance: ${mcpConnectUrl}. Official Agent-Native setup documentation: ${CONTENT_MCP_SETUP_DOCUMENTATION_URL}. Content MCP read action: ${CONTENT_DOCUMENT_READ_ACTION} with id ${JSON.stringify(documentId)}.`;
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
  accessState,
}: {
  document: { id: string; title?: string };
  token?: string | null;
  basePath?: string;
  origin?: string;
  accessState: ContentDocumentAccessState;
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
      accessState,
    }).instructions,
  });
  return {
    ...discovery,
    ...buildContentDocumentMcpGuidance(document.id, {
      basePath,
      origin,
      accessState,
    }),
  };
}
