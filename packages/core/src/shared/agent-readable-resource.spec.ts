import { describe, expect, it } from "vitest";

import {
  AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
  buildAgentReadableResourceDiscovery,
  renderAgentReadableResourceDiscoveryScript,
  safeJsonForHtml,
} from "./agent-readable-resource.js";

describe("agent-readable-resource helpers", () => {
  it("builds page and context URLs for a scoped agent-access token", () => {
    expect(
      buildAgentReadableResourceDiscovery({
        resourceType: "deck",
        resourceId: "deck 1",
        title: "Q3 Board Update",
        path: "/p/deck 1",
        contextEndpoint: "/api/deck-agent-context.json",
        origin: "https://slides.example.com",
        basePath: "/app",
        token: "tok+1",
        expiresAt: "2026-01-01T00:00:00.000Z",
        instructions: "Read contextUrl.",
      }),
    ).toEqual({
      type: AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
      resourceType: "deck",
      resourceId: "deck 1",
      title: "Q3 Board Update",
      url: "https://slides.example.com/app/p/deck 1?agent_access=tok%2B1",
      contextUrl:
        "https://slides.example.com/app/api/deck-agent-context.json?id=deck+1&agent_access=tok%2B1",
      expiresAt: "2026-01-01T00:00:00.000Z",
      instructions: "Read contextUrl.",
    });
  });

  it("renders script-safe JSON without raw HTML delimiters", () => {
    const script = renderAgentReadableResourceDiscoveryScript(
      {
        type: AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
        resourceType: "document",
        resourceId: "doc-1",
        title: "</script><img src=x>",
        contextUrl: "/api/document-agent-context.json?id=doc-1",
      },
      { id: 'resource"context' },
    );

    expect(script).toContain('id="resource&quot;context"');
    expect(script).not.toContain("</script><img");
    expect(script).toContain("\\u003c/script\\u003e");
  });

  it("escapes characters that can break inline JSON", () => {
    expect(safeJsonForHtml({ value: "<>&\u2028\u2029" })).toBe(
      '{"value":"\\u003c\\u003e\\u0026\\u2028\\u2029"}',
    );
  });
});
