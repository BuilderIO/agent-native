import { describe, expect, it } from "vitest";

import {
  workspaceAppDirectHref,
  workspaceAppEmbedTarget,
} from "./workspace-apps";

describe("workspaceAppEmbedTarget", () => {
  it("uses the app URL as the embed root when a mount path is also present", () => {
    expect(
      workspaceAppEmbedTarget({
        path: "/content",
        url: "https://workspace.example.test/content",
      }),
    ).toEqual({ url: "https://workspace.example.test/content" });
  });

  it("falls back to the mounted path when no app URL is available", () => {
    expect(workspaceAppEmbedTarget({ path: "/content", url: null })).toEqual({
      path: "/content",
    });
  });
});

describe("workspaceAppDirectHref", () => {
  it("joins an app-relative route onto an absolute app URL", () => {
    expect(
      workspaceAppDirectHref(
        { path: "/atlas", url: "https://workspace.example.test/atlas" },
        "/emails?status=failed#latest",
      ),
    ).toBe("https://workspace.example.test/atlas/emails?status=failed#latest");
  });

  it("does not duplicate a mount path already present in the target", () => {
    expect(
      workspaceAppDirectHref(
        { path: "/atlas", url: "https://workspace.example.test/atlas" },
        "/atlas",
      ),
    ).toBe("https://workspace.example.test/atlas");
  });

  it("resolves a mounted relative app path", () => {
    expect(workspaceAppDirectHref({ path: "/atlas" }, "/emails")).toBe(
      "/atlas/emails",
    );
  });

  it("falls back to a safe mount path when the app URL is invalid", () => {
    expect(
      workspaceAppDirectHref(
        { path: "/atlas", url: "javascript:alert(1)" },
        "/",
      ),
    ).toBe("/atlas");
  });

  it("rejects an unsafe target path", () => {
    expect(workspaceAppDirectHref({ path: "/atlas" }, "//evil.example")).toBe(
      null,
    );
  });
});
