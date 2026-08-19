// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import {
  navigateToWorkspaceApp,
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

describe("navigateToWorkspaceApp", () => {
  afterEach(() => {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: window,
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: window,
    });
  });

  it("uses the top window when Dispatch is embedded", () => {
    const topWindow = { location: { href: "" } } as unknown as Window;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    navigateToWorkspaceApp("/mail");

    expect(topWindow.location.href).toBe(
      new URL("/mail", window.location.href).href,
    );
  });

  it("reports when the embedded top window rejects navigation", () => {
    const location = {} as Location;
    Object.defineProperty(location, "href", {
      configurable: true,
      set: () => {
        throw new Error("Top navigation is blocked");
      },
    });
    const topWindow = { location } as unknown as Window;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    expect(navigateToWorkspaceApp("/mail")).toBe(false);
  });

  it("rejects non-http navigation targets", () => {
    const topWindow = { location: { href: "" } } as unknown as Window;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: topWindow,
    });

    expect(navigateToWorkspaceApp("javascript:alert(1)")).toBe(false);
    expect(topWindow.location.href).toBe("");
  });
});
