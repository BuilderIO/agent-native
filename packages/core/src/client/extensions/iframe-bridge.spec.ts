import { describe, expect, it } from "vitest";
import {
  isAllowedExtensionPath,
  sanitizeExtensionRequestOptions,
  checkBridgePolicy,
} from "./iframe-bridge.js";

describe("extension iframe bridge", () => {
  it("allows documented helper paths under /_agent-native/", () => {
    expect(isAllowedExtensionPath("/_agent-native/extensions/proxy", "extension-1")).toBe(
      true,
    );
    expect(isAllowedExtensionPath("/_agent-native/extensions/sql/query", "extension-1")).toBe(
      true,
    );
    expect(
      isAllowedExtensionPath(
        "/_agent-native/extensions/data/extension-1/notes?scope=user",
        "extension-1",
      ),
    ).toBe(true);
    expect(
      isAllowedExtensionPath("/_agent-native/actions/list-items", "extension-1"),
    ).toBe(true);
    expect(
      isAllowedExtensionPath(
        "/_agent-native/application-state/navigation",
        "extension-1",
      ),
    ).toBe(true);
  });

  it("blocks template /api/* routes — extensions must use actions", () => {
    expect(isAllowedExtensionPath("/api/custom-endpoint", "extension-1")).toBe(false);
    expect(isAllowedExtensionPath("/api/uploads", "extension-1")).toBe(false);
    expect(isAllowedExtensionPath("/api/billing/charge", "extension-1")).toBe(false);
    expect(isAllowedExtensionPath("/auth/sign-out", "extension-1")).toBe(false);
  });

  it("blocks sensitive framework paths and cross-extension data paths", () => {
    expect(isAllowedExtensionPath("/_agent-native/secrets/adhoc", "extension-1")).toBe(
      false,
    );
    expect(isAllowedExtensionPath("/_agent-native/extensions/extension-1", "extension-1")).toBe(
      false,
    );
    expect(
      isAllowedExtensionPath("/_agent-native/extensions/data/extension-2/notes", "extension-1"),
    ).toBe(false);
  });

  it("blocks path traversal and absolute URL forms", () => {
    expect(isAllowedExtensionPath("//evil.example/path", "extension-1")).toBe(false);
    expect(
      isAllowedExtensionPath("/api/%2e%2e/_agent-native/secrets", "extension-1"),
    ).toBe(false);
    expect(isAllowedExtensionPath("/api\\secret", "extension-1")).toBe(false);
  });

  it("drops ambient browser headers and rejects unsupported methods", () => {
    expect(
      sanitizeExtensionRequestOptions({
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

    expect(() => sanitizeExtensionRequestOptions({ method: "TRACE" })).toThrowError(
      "Extension request method is not allowed",
    );
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
      checkBridgePolicy("/_agent-native/extensions/sql/exec", "POST", owner).ok,
    ).toBe(true);
    expect(
      checkBridgePolicy("/_agent-native/extensions/proxy", "POST", owner).ok,
    ).toBe(true);
  });

  it("editors keep mutating bridge surfaces", () => {
    expect(
      checkBridgePolicy("/_agent-native/actions/foo", "POST", editor).ok,
    ).toBe(true);
    expect(
      checkBridgePolicy("/_agent-native/extensions/sql/exec", "POST", editor).ok,
    ).toBe(true);
    expect(
      checkBridgePolicy("/_agent-native/extensions/proxy", "POST", editor).ok,
    ).toBe(true);
  });

  it("denies SQL helpers entirely for viewers", () => {
    const queryRes = checkBridgePolicy(
      "/_agent-native/extensions/sql/query",
      "POST",
      viewer,
    );
    expect(queryRes.ok).toBe(false);
    expect(queryRes.error).toMatch(/dbQuery/);

    const execRes = checkBridgePolicy(
      "/_agent-native/extensions/sql/exec",
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

  it("denies extensionFetch for viewers (the proxy POST surface)", () => {
    const res = checkBridgePolicy("/_agent-native/extensions/proxy", "POST", viewer);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/extensionFetch/);
  });

  it("allows viewers to read extension-data (GET) but not write/delete", () => {
    expect(
      checkBridgePolicy("/_agent-native/extensions/data/extension-1/notes", "GET", viewer)
        .ok,
    ).toBe(true);
    const writeRes = checkBridgePolicy(
      "/_agent-native/extensions/data/extension-1/notes",
      "POST",
      viewer,
    );
    expect(writeRes.ok).toBe(false);
    expect(writeRes.error).toMatch(/extensionData/);
    const delRes = checkBridgePolicy(
      "/_agent-native/extensions/data/extension-1/notes/x",
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
