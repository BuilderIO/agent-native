import { describe, expect, it } from "vitest";

import { safeHttpUrl } from "./safe-http-url";

describe("safeHttpUrl", () => {
  it("keeps http and https links", () => {
    expect(
      safeHttpUrl("https://github.com/BuilderIO/agent-native/pull/1"),
    ).toBe("https://github.com/BuilderIO/agent-native/pull/1");
    expect(safeHttpUrl("http://localhost:3000/inbox")).toBe(
      "http://localhost:3000/inbox",
    );
  });

  it("omits executable and non-http schemes", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
    expect(safeHttpUrl("/relative/path")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});
