import { AGENT_READABLE_RESOURCE_PAYLOAD_TYPE } from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import {
  buildContentDocumentAgentDiscovery,
  buildContentPublicDocumentPath,
  buildContentPublicDocumentUrl,
  DOCUMENT_AGENT_READABLE_INSTRUCTIONS,
} from "./agent-readable";

describe("content agent-readable discovery", () => {
  it("builds public document paths without a mount prefix", () => {
    expect(buildContentPublicDocumentPath("doc-1")).toBe("/p/doc-1");
  });

  it("adds the configured app base path to public document URLs", () => {
    expect(
      buildContentPublicDocumentUrl("doc 1", { basePath: "/content/" }),
    ).toBe("/content/p/doc 1");
  });

  it("preserves agent access on base-prefixed document URLs", () => {
    expect(
      buildContentPublicDocumentUrl("doc-1", {
        basePath: "/content",
        token: "tok+1",
      }),
    ).toBe("/content/p/doc-1?agent_access=tok%2B1");
  });

  it("advertises base-prefixed public page and JSON context URLs", () => {
    expect(
      buildContentDocumentAgentDiscovery({
        document: { id: "doc 1", title: "Launch notes" },
        basePath: "/content",
        token: "tok+1",
      }),
    ).toEqual({
      type: AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
      resourceType: "document",
      resourceId: "doc 1",
      title: "Launch notes",
      url: "/content/p/doc 1?agent_access=tok%2B1",
      contextUrl:
        "/content/api/document-agent-context.json?id=doc+1&agent_access=tok%2B1",
      instructions: DOCUMENT_AGENT_READABLE_INSTRUCTIONS,
    });
  });
});
