import { describe, expect, it } from "vitest";

import { normalizeDispatchBaseUrl } from "./settings";

describe("Dispatch URL configuration", () => {
  it("normalizes credential-free web URLs and rejects unsafe values", () => {
    expect(normalizeDispatchBaseUrl("https://dispatch.agent-native.com/")).toBe(
      "https://dispatch.agent-native.com",
    );
    expect(normalizeDispatchBaseUrl("http://localhost:3000/dispatch/")).toBe(
      "http://localhost:3000/dispatch",
    );
    expect(
      normalizeDispatchBaseUrl("https://user:pass@example.com"),
    ).toBeNull();
    expect(
      normalizeDispatchBaseUrl("https://example.com/?token=example"),
    ).toBeNull();
    expect(normalizeDispatchBaseUrl("chrome://extensions")).toBeNull();
  });
});
