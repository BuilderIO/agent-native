import { afterEach, describe, expect, it } from "vitest";

import {
  buildCodeLayerProjection,
  clearCodeLayerProjectionCache,
  resolveCodeLayerTarget,
  type CodeLayerSource,
} from "./code-layer";

afterEach(() => clearCodeLayerProjectionCache());

const SOURCE: CodeLayerSource = {
  kind: "design-file",
  designId: "design-1",
  fileId: "screen-1",
  filename: "dashboard.html",
};

const SCREEN = `<!DOCTYPE html>
<html><body>
  <main>
    <header class="top"><h1 class="title">Revenue</h1></header>
    <section id="stats"><p class="stat">42</p><p class="stat">7</p></section>
  </main>
</body></html>`;

// A rebuilt file object carries an equal string, not the same one.
const sameText = (html: string) => (" " + html).slice(1);

describe("code layer projection cache", () => {
  it("reuses a screen's projection when its file is rebuilt with the same content", () => {
    const first = buildCodeLayerProjection(SCREEN, { source: SOURCE });

    expect(buildCodeLayerProjection(sameText(SCREEN), { source: SOURCE })).toBe(
      first,
    );
    expect(
      resolveCodeLayerTarget(
        sameText(SCREEN),
        { selector: "h1" },
        {
          source: SOURCE,
        },
      ).projection,
    ).toBe(first);
  });

  it("projects a new version of the screen afresh", () => {
    const first = buildCodeLayerProjection(SCREEN, { source: SOURCE });
    const edited = SCREEN.replace("Revenue", "Bookings");

    const next = buildCodeLayerProjection(edited, { source: SOURCE });

    expect(next).not.toBe(first);
    expect(next.nodes.find((node) => node.tag === "h1")?.textSnippet).toBe(
      "Bookings",
    );
  });

  it("resolves the same layer for a selector on every lookup", () => {
    const lookups = [
      "h1",
      "main > header > h1",
      "body > main > header > h1.title",
      "#stats > p:nth-of-type(2)",
      "header .title",
    ];
    const resolveIds = () =>
      lookups.map((selector) => {
        const { resolution } = resolveCodeLayerTarget(
          SCREEN,
          { selector },
          { source: SOURCE },
        );
        return resolution.status === "resolved"
          ? `${resolution.node?.tag}:${resolution.node?.id}`
          : resolution.status;
      });

    const first = resolveIds();

    expect(first.slice(0, 3).every((id) => id.startsWith("h1:"))).toBe(true);
    expect(first[3]).toMatch(/^p:/);
    expect(resolveIds()).toEqual(first);
  });
});
