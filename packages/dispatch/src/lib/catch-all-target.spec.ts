import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadWorkspaceAppsManifestMock = vi.hoisted(() => vi.fn());
const getBuiltinAgentsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  loadWorkspaceAppsManifest: loadWorkspaceAppsManifestMock,
  getBuiltinAgents: getBuiltinAgentsMock,
}));

import { resolveCatchAllTarget } from "./catch-all-target.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveCatchAllTarget", () => {
  it("prefers the workspace manifest entry when one matches", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "todo", name: "Todo", path: "/todo" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([
      {
        id: "todo",
        name: "Todo",
        description: "",
        url: "https://todo.example.com",
        color: "#000",
      },
    ]);

    expect(resolveCatchAllTarget("todo")).toBe("/todo");
  });

  it("falls back to the built-in template URL when no workspace manifest exists", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue(null);
    getBuiltinAgentsMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        description: "",
        url: "http://localhost:8084",
        color: "#06B6D4",
      },
    ]);

    expect(resolveCatchAllTarget("forms")).toBe("http://localhost:8084");
  });

  it("falls back to the built-in template URL when the workspace manifest does not include the app", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        description: "",
        url: "http://localhost:8084",
        color: "#06B6D4",
      },
    ]);

    expect(resolveCatchAllTarget("forms")).toBe("http://localhost:8084");
  });

  it("normalizes a manifest entry without a leading slash", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "todo", name: "Todo", path: "todo" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("todo")).toBe("/todo");
  });

  it("uses app.path when id !== path (not /${appId})", () => {
    // Before the fix, an entry whose mounted path differs from its id —
    // e.g. id: "forms", path: "my-forms" without a leading slash — was
    // silently rewritten to `/forms` (the appId) and routed to the wrong
    // app. The normalizer now keeps the manifest path and only prepends
    // the missing slash.
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "forms", name: "Forms", path: "my-forms" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("/my-forms");
  });

  it("prefers app.url when the manifest entry has an externally-hosted URL", () => {
    // Workspaces can point at remote deploys. The catch-all should bounce
    // to the absolute URL instead of mounting a local path that doesn't
    // exist inside the gateway.
    loadWorkspaceAppsManifestMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        path: "/forms",
        url: "https://forms.example.com",
      },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("https://forms.example.com");
  });

  it("ignores app.url that isn't an absolute http(s) URL and falls back to path", () => {
    // Bare hostname — `new URL("forms.example.com")` throws, so the value
    // is rejected and we fall through to the (validated) path. Without
    // this, the catch-all would `throw redirect("forms.example.com")`
    // and the browser would treat the value as a relative path inside the
    // gateway, producing a broken redirect.
    loadWorkspaceAppsManifestMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        path: "/forms",
        url: "forms.example.com",
      },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("/forms");
  });

  it("rejects non-http(s) URL schemes (e.g. javascript:) and falls back to path", () => {
    // Defense in depth — a hostile manifest entry can't produce a
    // `javascript:` redirect target. Validation enforces http(s) only.
    loadWorkspaceAppsManifestMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        path: "/forms",
        url: "javascript:alert(1)",
      },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("/forms");
  });

  it("strips a trailing slash from app.url", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        path: "/forms",
        url: "https://forms.example.com/",
      },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("https://forms.example.com");
  });

  it("ignores an empty/whitespace app.url and falls back to path", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      {
        id: "forms",
        name: "Forms",
        path: "/forms",
        url: "   ",
      },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("/forms");
  });

  it("collapses leading slashes/backslashes in app.path so `/\\evil.example` can't redirect off-origin", () => {
    // Browsers normalize backslashes to forward slashes during URL
    // parsing, so `throw redirect("/\\evil.example")` would resolve to
    // `https://evil.example`. The regex covers both slash types.
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "forms", name: "Forms", path: "/\\evil.example" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("/evil.example");
  });

  it("collapses leading double slashes in app.path so `//evil.example` can't redirect off-origin", () => {
    // The manifest parser only checks `startsWith("/")`, so a path of
    // `//evil.example` slips through. Browsers treat that as a network-
    // path reference and `throw redirect("//evil.example")` would redirect
    // to `https://evil.example` — the same phishing vector the `app.url`
    // validator closes. Collapse the leading slashes so the redirect
    // stays on the gateway.
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "forms", name: "Forms", path: "//evil.example" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("/evil.example");
  });

  it("falls back to /${appId} when the manifest entry has neither path nor url", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "forms", name: "Forms", path: "" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("forms")).toBe("/forms");
  });

  it("returns null when nothing matches", () => {
    loadWorkspaceAppsManifestMock.mockReturnValue([
      { id: "dispatch", name: "Dispatch", path: "/dispatch" },
    ]);
    getBuiltinAgentsMock.mockReturnValue([]);

    expect(resolveCatchAllTarget("unknown-app")).toBeNull();
  });
});
