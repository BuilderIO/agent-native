import { describe, expect, it } from "vitest";

import { resolveInitialResourceScope } from "./ResourcesPanel.js";

describe("resolveInitialResourceScope", () => {
  it("preserves an explicitly requested organization scope for read-only members", () => {
    expect(resolveInitialResourceScope("shared", false)).toBe("shared");
  });

  it("keeps the existing fallback when the panel has no requested scope", () => {
    expect(resolveInitialResourceScope(undefined, false)).toBe("personal");
    expect(resolveInitialResourceScope(undefined, true)).toBe("shared");
  });
});
