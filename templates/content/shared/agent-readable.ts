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
export const DOCUMENT_AGENT_READABLE_INSTRUCTIONS =
  "Use contextUrl to read this shared Content document as structured JSON. The page is read-only for token and public viewers.";

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
  document: { id: string; title: string };
  token?: string | null;
  basePath?: string;
}): AgentReadableResourceDiscovery {
  return buildAgentReadableResourceDiscovery({
    resourceType: "document",
    resourceId: document.id,
    title: document.title,
    path: buildContentPublicDocumentPath(document.id),
    contextEndpoint: DOCUMENT_AGENT_CONTEXT_ENDPOINT,
    token,
    basePath,
    instructions: DOCUMENT_AGENT_READABLE_INSTRUCTIONS,
  });
}
