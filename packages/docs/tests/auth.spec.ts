import { describe, expect, it } from "vitest";
import { shouldCreateDocsSessionForPath } from "../server/plugins/auth.js";

describe("docs auth session scoping", () => {
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
});
