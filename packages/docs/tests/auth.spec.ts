import { mockEvent } from "h3";
import { describe, expect, it } from "vitest";

import {
  docsAuthOptions,
  isDocsWebMcpPath,
  shouldCreateDocsSessionForPath,
} from "../server/plugins/auth.js";

describe("docs auth session scoping", () => {
  it("marks docs pages as public in runtime auth config", () => {
    expect(docsAuthOptions.workspaceAppAudience).toBe("public");
  });

  it("creates anonymous sessions for framework and API routes under a mount path", () => {
    expect(
      shouldCreateDocsSessionForPath(
        "/docs/_agent-native/auth/session",
        "/docs",
      ),
    ).toBe(true);
    expect(shouldCreateDocsSessionForPath("/docs/api/search", "/docs")).toBe(
      true,
    );
  });

  it("does not create anonymous sessions for public page routes under a mount path", () => {
    expect(shouldCreateDocsSessionForPath("/docs", "/docs")).toBe(false);
    expect(
      shouldCreateDocsSessionForPath("/docs/getting-started", "/docs"),
    ).toBe(false);
  });

  it("does not authenticate WebMCP requests with the synthetic docs cookie", async () => {
    expect(
      isDocsWebMcpPath("/docs/_agent-native/webmcp/manifest", "/docs"),
    ).toBe(true);
    expect(isDocsWebMcpPath("/docs/mcp/tool/search-docs", "/docs")).toBe(true);

    const event = mockEvent(
      "https://docs.example.com/_agent-native/webmcp/manifest",
      { headers: { cookie: "an_docs_session=existing" } },
    );
    await expect(docsAuthOptions.getSession!(event)).resolves.toBeNull();
  });
});
