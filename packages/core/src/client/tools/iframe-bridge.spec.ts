import { describe, expect, it } from "vitest";
import {
  isAllowedToolPath,
  sanitizeToolRequestOptions,
} from "./iframe-bridge.js";

describe("tool iframe bridge", () => {
  it("allows documented helper paths under /_agent-native/", () => {
    expect(isAllowedToolPath("/_agent-native/tools/proxy", "tool-1")).toBe(
      true,
    );
    expect(isAllowedToolPath("/_agent-native/tools/sql/query", "tool-1")).toBe(
      true,
    );
    expect(
      isAllowedToolPath(
        "/_agent-native/tools/data/tool-1/notes?scope=user",
        "tool-1",
      ),
    ).toBe(true);
    expect(
      isAllowedToolPath("/_agent-native/actions/list-items", "tool-1"),
    ).toBe(true);
    expect(
      isAllowedToolPath(
        "/_agent-native/application-state/navigation",
        "tool-1",
      ),
    ).toBe(true);
  });

  it("blocks template /api/* routes — tools must use actions", () => {
    expect(isAllowedToolPath("/api/custom-endpoint", "tool-1")).toBe(false);
    expect(isAllowedToolPath("/api/uploads", "tool-1")).toBe(false);
    expect(isAllowedToolPath("/api/billing/charge", "tool-1")).toBe(false);
    expect(isAllowedToolPath("/auth/sign-out", "tool-1")).toBe(false);
  });

  it("blocks sensitive framework paths and cross-tool data paths", () => {
    expect(isAllowedToolPath("/_agent-native/secrets/adhoc", "tool-1")).toBe(
      false,
    );
    expect(isAllowedToolPath("/_agent-native/tools/tool-1", "tool-1")).toBe(
      false,
    );
    expect(
      isAllowedToolPath("/_agent-native/tools/data/tool-2/notes", "tool-1"),
    ).toBe(false);
  });

  it("blocks path traversal and absolute URL forms", () => {
    expect(isAllowedToolPath("//evil.example/path", "tool-1")).toBe(false);
    expect(
      isAllowedToolPath("/api/%2e%2e/_agent-native/secrets", "tool-1"),
    ).toBe(false);
    expect(isAllowedToolPath("/api\\secret", "tool-1")).toBe(false);
  });

  it("drops ambient browser headers and rejects unsupported methods", () => {
    expect(
      sanitizeToolRequestOptions({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "an_session=secret",
          Host: "internal",
          "X-Forwarded-For": "127.0.0.1",
        },
        body: { ok: true },
      }),
    ).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"ok":true}',
    });

    expect(() => sanitizeToolRequestOptions({ method: "TRACE" })).toThrowError(
      "Tool request method is not allowed",
    );
  });
});
