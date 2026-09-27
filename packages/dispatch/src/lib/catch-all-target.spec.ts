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

  it("keeps the legacy mounted path for normalized agent IDs", () => {
    expect(
      resolveCatchAllTarget("clips", {
        workspaceApps: [{ id: "clips", path: "/videos" }],
      }),
    ).toBe("/videos");
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
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [{ id: "forms", path: "my-forms" }],
      }),
    ).toBe("/my-forms");
  });

  it("prefers app.url when the manifest entry has an externally-hosted URL", () => {
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
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [
          { id: "forms", path: "/forms", url: "forms.example.com" },
        ],
      }),
    ).toBe("/forms");
  });

  it("rejects non-http(s) URL schemes (e.g. javascript:) and falls back to path", () => {
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
    expect(
      resolveCatchAllTarget("forms", {
        workspaceApps: [{ id: "forms", path: "/\\evil.example" }],
      }),
    ).toBe("/evil.example");
  });

  it("collapses leading double slashes in app.path so `//evil.example` can't redirect off-origin", () => {
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
