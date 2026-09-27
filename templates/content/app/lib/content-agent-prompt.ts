import {
  buildContentDocumentMcpGuidance,
  buildContentPublicDocumentUrl,
  CONTENT_MCP_SETUP_DOCUMENTATION_URL,
} from "@shared/agent-readable";

export function contentAgentPromptValues({
  documentId,
  origin,
  basePath,
}: {
  documentId: string;
  origin: string;
  basePath?: string;
}) {
  const guidance = buildContentDocumentMcpGuidance(documentId, {
    origin,
    basePath,
  });

  return {
    documentUrl: new URL(
      buildContentPublicDocumentUrl(encodeURIComponent(documentId), {
        basePath,
      }),
      origin,
    ).toString(),
    mcpUrl: guidance.mcpUrl,
    documentId,
    connectUrl: guidance.mcpConnectUrl,
    docsUrl: CONTENT_MCP_SETUP_DOCUMENTATION_URL,
  };
}
