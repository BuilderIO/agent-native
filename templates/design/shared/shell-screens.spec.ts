import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHELL_SCREEN_HEIGHT,
  DEFAULT_SHELL_SCREEN_WIDTH,
  MAX_SHELL_SCREENS,
  buildShellScreens,
} from "./shell-screens";

const build = (
  paths: string[],
  previewOrigin = "https://branch.builderio.xyz",
) => buildShellScreens({ previewOrigin, paths });

describe("buildShellScreens", () => {
  it("joins each route onto the preview origin", () => {
    const { screens } = build(["/", "/projects", "/blog/posts"]);
    expect(screens.map((s) => s.url)).toEqual([
      "https://branch.builderio.xyz/",
      "https://branch.builderio.xyz/projects",
      "https://branch.builderio.xyz/blog/posts",
    ]);
  });

  it("derives the same filenames the server builder does", () => {
    const { screens } = build(["/", "/projects", "/blog/posts"]);
    expect(screens.map((s) => s.filename)).toEqual([
      "fusion-home.html",
      "fusion-projects.html",
      "fusion-blog-posts.html",
    ]);
  });

  it("titles routes from their last segment", () => {
    const { screens } = build(["/", "/design-systems", "/blog/my_post"]);
    expect(screens.map((s) => s.title)).toEqual([
      "Home",
      "Design Systems",
      "My Post",
    ]);
  });

  it("keeps ids stable across rebuilds so selection survives a remount", () => {
    const first = build(["/", "/projects"]);
    const second = build(["/", "/projects"]);
    expect(second.screens.map((s) => s.fileId)).toEqual(
      first.screens.map((s) => s.fileId),
    );
  });

  it("lays frames out in a row with a gap", () => {
    const { placedFrames } = build(["/", "/a", "/b"]);
    expect(placedFrames.map((f) => f.frame.x)).toEqual([0, 1440, 2880]);
    expect(placedFrames.every((f) => f.frame.y === 0)).toBe(true);
    expect(placedFrames[0]!.frame.width).toBe(DEFAULT_SHELL_SCREEN_WIDTH);
    expect(placedFrames[0]!.frame.height).toBe(DEFAULT_SHELL_SCREEN_HEIGHT);
  });

  it("pairs every screen with exactly one frame", () => {
    const { screens, placedFrames } = build(["/", "/a", "/b"]);
    expect(placedFrames.map((f) => f.fileId)).toEqual(
      screens.map((s) => s.fileId),
    );
  });

  it("collapses a duplicated route instead of stacking two frames on it", () => {
    const { screens } = build(["/", "/a", "/"]);
    expect(screens).toHaveLength(2);
  });

  it("disambiguates distinct routes that slug to the same name", () => {
    const { screens } = build(["/a/b", "/a-b"]);
    expect(screens.map((s) => s.filename)).toEqual([
      "fusion-a-b.html",
      "fusion-a-b-2.html",
    ]);
    expect(new Set(screens.map((s) => s.fileId)).size).toBe(2);
  });

  it("normalises a route missing its leading slash", () => {
    const { screens } = build(["projects"]);
    expect(screens[0]!.path).toBe("/projects");
    expect(screens[0]!.url).toBe("https://branch.builderio.xyz/projects");
  });

  it("tolerates a preview origin that already ends in a slash", () => {
    const { screens } = build(["/x"], "https://branch.builderio.xyz/");
    expect(screens[0]!.url).toBe("https://branch.builderio.xyz/x");
  });

  it("returns nothing for no routes rather than throwing", () => {
    // The host may send design:init before it has resolved any routes.
    expect(build([])).toEqual({ screens: [], placedFrames: [] });
  });

  it("keeps every frame on the preview origin", () => {
    // `//host` loses its slashes to the strip, but `/\\host` survives it and
    // resolves protocol-relative — that one placed a frame on another origin.
    const { screens } = buildShellScreens({
      previewOrigin: "https://preview.test",
      paths: ["/", "//evil.test", "/\\\\evil.test", "/about"],
    });
    for (const screen of screens) {
      expect(new URL(screen.url).origin).toBe("https://preview.test");
    }
    expect(screens.some((screen) => screen.url.includes("evil.test/"))).toBe(
      false,
    );
  });

  it("resolves routes against the origin, not a previewed route", () => {
    // Builder sends `interactiveFrameUrl`, which carries whatever route the
    // user is on; nesting under it produced `/app.html/about`.
    const { screens } = buildShellScreens({
      previewOrigin: "https://preview.test",
      paths: ["/about"],
    });
    expect(screens[1]?.url ?? screens[0]?.url).toBe(
      "https://preview.test/about",
    );
  });

  it("caps how many frames a route list can mount", () => {
    const { screens, placedFrames } = buildShellScreens({
      previewOrigin: "https://preview.test",
      paths: Array.from({ length: MAX_SHELL_SCREENS + 25 }, (_, i) => `/r${i}`),
    });
    expect(screens.length).toBeLessThanOrEqual(MAX_SHELL_SCREENS);
    expect(placedFrames.length).toBeLessThanOrEqual(MAX_SHELL_SCREENS);
  });
});
