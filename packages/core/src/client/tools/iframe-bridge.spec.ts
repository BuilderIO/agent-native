import { describe, expect, it } from "vitest";
import {
  isAllowedToolPath,
  sanitizeToolRequestOptions,
  checkBridgePolicy,
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

  it("allows the per-tool grant-consent path (audit C1)", () => {
    expect(
      isAllowedToolPath("/_agent-native/tools/tool-1/grant-consent", "tool-1"),
    ).toBe(true);
    // Only the iframe's own tool may grant — not another tool's id.
    expect(
      isAllowedToolPath("/_agent-native/tools/tool-2/grant-consent", "tool-1"),
    ).toBe(false);
  });
});

describe("checkBridgePolicy (audit H4)", () => {
  const owner = { role: "owner" as const, isAuthor: true };
  const editor = { role: "editor" as const, isAuthor: false };
  const viewer = { role: "viewer" as const, isAuthor: false };

  it("authors and owners pass every helper", () => {
    expect(
      checkBridgePolicy("/_agent-native/actions/foo", "POST", owner).ok,
    ).toBe(true);
    expect(
      checkBridgePolicy("/_agent-native/tools/sql/exec", "POST", owner).ok,
    ).toBe(true);
    expect(
      checkBridgePolicy("/_agent-native/tools/proxy", "POST", owner).ok,
    ).toBe(true);
  });

  it("editors keep mutating bridge surfaces", () => {
    expect(
      checkBridgePolicy("/_agent-native/actions/foo", "POST", editor).ok,
    ).toBe(true);
    expect(
      checkBridgePolicy("/_agent-native/tools/sql/exec", "POST", editor).ok,
    ).toBe(true);
    expect(
      checkBridgePolicy("/_agent-native/tools/proxy", "POST", editor).ok,
    ).toBe(true);
  });

  it("denies SQL helpers entirely for viewers", () => {
    const queryRes = checkBridgePolicy(
      "/_agent-native/tools/sql/query",
      "POST",
      viewer,
    );
    expect(queryRes.ok).toBe(false);
    expect(queryRes.error).toMatch(/dbQuery/);

    const execRes = checkBridgePolicy(
      "/_agent-native/tools/sql/exec",
      "POST",
      viewer,
    );
    expect(execRes.ok).toBe(false);
    expect(execRes.error).toMatch(/dbExec/);
    expect(execRes.error).toMatch(/'viewer'/);
  });

  it("denies appAction (any method) for viewers", () => {
    const res = checkBridgePolicy(
      "/_agent-native/actions/share-resource",
      "POST",
      viewer,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/appAction/);

    // Even a GET action is denied — viewers can't trigger side-effects.
    const getRes = checkBridgePolicy(
      "/_agent-native/actions/list-things",
      "GET",
      viewer,
    );
    expect(getRes.ok).toBe(false);
  });

  it("denies toolFetch for viewers (the proxy POST surface)", () => {
    const res = checkBridgePolicy("/_agent-native/tools/proxy", "POST", viewer);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/toolFetch/);
  });

  it("allows viewers to read tool-data (GET) but not write/delete", () => {
    expect(
      checkBridgePolicy("/_agent-native/tools/data/tool-1/notes", "GET", viewer)
        .ok,
    ).toBe(true);
    const writeRes = checkBridgePolicy(
      "/_agent-native/tools/data/tool-1/notes",
      "POST",
      viewer,
    );
    expect(writeRes.ok).toBe(false);
    expect(writeRes.error).toMatch(/toolData/);
    const delRes = checkBridgePolicy(
      "/_agent-native/tools/data/tool-1/notes/x",
      "DELETE",
      viewer,
    );
    expect(delRes.ok).toBe(false);
  });

  it("allows application-state reads but blocks writes for viewers", () => {
    expect(
      checkBridgePolicy(
        "/_agent-native/application-state/navigation",
        "GET",
        viewer,
      ).ok,
    ).toBe(true);
    const writeRes = checkBridgePolicy(
      "/_agent-native/application-state/navigation",
      "POST",
      viewer,
    );
    expect(writeRes.ok).toBe(false);
    expect(writeRes.error).toMatch(/appFetch/);
  });
});
