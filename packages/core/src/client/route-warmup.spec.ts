// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { __routeWarmupInternalsForTests } from "./route-warmup.js";

const {
  getManifestRouteTree,
  parseBuildTimeRouteWarmupConfig,
  renderWarmupLinksForSelector,
  resetRouteWarmupCachesForTests,
} = __routeWarmupInternalsForTests;

describe("route warmup runtime helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetRouteWarmupCachesForTests();
  });

  it("parses JSON-injected route warmup config strings", () => {
    expect(
      parseBuildTimeRouteWarmupConfig(
        JSON.stringify({ strategy: "viewport", data: false }),
      ),
    ).toEqual({ strategy: "viewport", data: false });
    expect(parseBuildTimeRouteWarmupConfig(JSON.stringify("render"))).toBe(
      "render",
    );
    expect(parseBuildTimeRouteWarmupConfig("render")).toBe("render");
  });

  it("refreshes the route tree when React Router patches manifest routes in place", () => {
    const manifest = {
      routes: {
        root: { id: "root", path: "/" },
      },
    };

    const initialTree = getManifestRouteTree(manifest);
    expect(initialTree[0]?.children).toBeUndefined();

    manifest.routes.docs = {
      id: "docs",
      parentId: "root",
      path: "docs",
    };

    const patchedTree = getManifestRouteTree(manifest);
    expect(patchedTree).not.toBe(initialTree);
    expect(patchedTree[0]?.children?.[0]).toMatchObject({
      id: "docs",
      path: "docs",
    });
  });

  it("finds render warmup links using the configured selector", () => {
    document.body.innerHTML = `
      <a href="/docs" class="warm">Docs</a>
      <span class="warm-wrapper"><a href="/templates">Templates</a></span>
      <a href="/skip">Skip</a>
    `;

    expect(
      renderWarmupLinksForSelector("a.warm[href], .warm-wrapper").map(
        (link) => new URL(link.href).pathname,
      ),
    ).toEqual(["/docs", "/templates"]);
  });

  it("ignores invalid custom selectors", () => {
    document.body.innerHTML = '<a href="/docs">Docs</a>';

    expect(renderWarmupLinksForSelector("[")).toEqual([]);
  });
});
