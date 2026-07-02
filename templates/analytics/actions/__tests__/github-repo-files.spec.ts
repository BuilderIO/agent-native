import { describe, expect, it } from "vitest";

import action from "../github-repo-files";

describe("github-repo-files action", () => {
  it("exposes GitHub repository inspection guidance", () => {
    expect(action.tool.description).toContain("tracking-event instrumentation");
    expect(action.tool.description).toContain("operation='search'");
    expect(typeof action.run).toBe("function");
  });

  it("requires approval for repository writes and deletes only", () => {
    expect(typeof action.needsApproval).toBe("function");
    if (typeof action.needsApproval !== "function") return;

    expect(action.needsApproval({ operation: "search" } as any)).toBe(false);
    expect(action.needsApproval({ operation: "read" } as any)).toBe(false);
    expect(action.needsApproval({ operation: "write" } as any)).toBe(true);
    expect(action.needsApproval({ operation: "delete" } as any)).toBe(true);
  });
});
