import { describe, expect, it } from "vitest";

import { resolveCatchAllTarget } from "./catch-all-target.js";

describe("resolveCatchAllTarget", () => {
  it("prefers the workspace manifest entry when one matches", () => {
    expect(
      resolveCatchAllTarget("todo", {
        workspaceApps: [{ id: "todo", path: "/todo" }],
        builtinAgents: [{ id: "todo", url: "https://todo.example.com" }],
      }),
    ).toBe("/todo");
  });

  it("falls back to the built-in template URL when no workspace manifest exists", () => {
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: null,
        builtinAgents: [{ id: "forms", url: "http://localhost:8084" }],
      }),
    ).toBe("http://localhost:8084");
  });

  it("falls back to the built-in template URL when the workspace manifest does not include the app", () => {
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [{ id: "dispatch", path: "/dispatch" }],
        builtinAgents: [{ id: "forms", url: "http://localhost:8084" }],
      }),
    ).toBe("http://localhost:8084");
  });

  it("normalizes a manifest entry without a leading slash", () => {
    expect(
      resolveCatchAllTarget("todo", {
        workspaceApps: [{ id: "todo", path: "todo" }],
      }),
    ).toBe("/todo");
  });

  it("uses app.path when id !== path (not /${appId})", () => {
    // Before the fix, an entry whose mounted path differs from its id —
    // e.g. id: "forms", path: "my-forms" without a leading slash — was
    // silently rewritten to `/forms` (the appId) and routed to the wrong
    // app. The normalizer now keeps the manifest path and only prepends
    // the missing slash.
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [{ id: "forms", path: "my-forms" }],
      }),
    ).toBe("/my-forms");
  });

  it("prefers app.url when the manifest entry has an externally-hosted URL", () => {
    // Workspaces can point at remote deploys. The catch-all should bounce
    // to the absolute URL instead of mounting a local path that doesn't
    // exist inside the gateway.
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [
          {
            id: "forms",
            path: "/forms",
            url: "https://forms.example.com",
          },
        ],
      }),
    ).toBe("https://forms.example.com");
  });

  it("ignores app.url that isn't an absolute http(s) URL and falls back to path", () => {
    // Bare hostname — `new URL("forms.example.com")` throws, so the value
    // is rejected and we fall through to the (validated) path. Without
    // this, the catch-all would `throw redirect("forms.example.com")`
    // and the browser would treat the value as a relative path inside the
    // gateway, producing a broken redirect.
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [
          { id: "forms", path: "/forms", url: "forms.example.com" },
        ],
      }),
    ).toBe("/forms");
  });

  it("rejects non-http(s) URL schemes (e.g. javascript:) and falls back to path", () => {
    // Defense in depth — a hostile manifest entry can't produce a
    // `javascript:` redirect target. Validation enforces http(s) only.
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [
          { id: "forms", path: "/forms", url: "javascript:alert(1)" },
        ],
      }),
    ).toBe("/forms");
  });

  it("strips a trailing slash from app.url", () => {
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [
          { id: "forms", path: "/forms", url: "https://forms.example.com/" },
        ],
      }),
    ).toBe("https://forms.example.com");
  });

  it("ignores an empty/whitespace app.url and falls back to path", () => {
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [{ id: "forms", path: "/forms", url: "   " }],
      }),
    ).toBe("/forms");
  });

  it("collapses leading slashes/backslashes in app.path so `/\\evil.example` can't redirect off-origin", () => {
    // Browsers normalize backslashes to forward slashes during URL
    // parsing, so `throw redirect("/\\evil.example")` would resolve to
    // `https://evil.example`. The regex covers both slash types.
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [{ id: "forms", path: "/\\evil.example" }],
      }),
    ).toBe("/evil.example");
  });

  it("collapses leading double slashes in app.path so `//evil.example` can't redirect off-origin", () => {
    // The manifest parser only checks `startsWith("/")`, so a path of
    // `//evil.example` slips through. Browsers treat that as a network-
    // path reference and `throw redirect("//evil.example")` would redirect
    // to `https://evil.example` — the same phishing vector the `app.url`
    // validator closes. Collapse the leading slashes so the redirect
    // stays on the gateway.
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [{ id: "forms", path: "//evil.example" }],
      }),
    ).toBe("/evil.example");
  });

  it("falls back to /${appId} when the manifest entry has neither path nor url", () => {
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [{ id: "forms", path: "" }],
      }),
    ).toBe("/forms");
  });

  it("returns null when nothing matches", () => {
    expect(
      resolveCatchAllTarget("unknown-app", {
        workspaceApps: [{ id: "dispatch", path: "/dispatch" }],
      }),
    ).toBeNull();
  });
});
