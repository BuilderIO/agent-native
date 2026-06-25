// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { __routeWarmupInternalsForTests } from "./route-warmup.js";

const {
  getManifestRouteTree,
  hasReactRouterManifestRoutes,
  hasWarmableRouteAssets,
  parseBuildTimeRouteWarmupConfig,
  renderWarmupLinksForSelector,
  routeAssetUrlsForHref,
  resetRouteWarmupCachesForTests,
} = __routeWarmupInternalsForTests;

describe("route warmup runtime helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete window.__reactRouterManifest;
    delete window.__reactRouterContext;
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

  it("requires a React Router manifest before route data warmup can run", () => {
    expect(hasReactRouterManifestRoutes()).toBe(false);

    window.__reactRouterManifest = { routes: {} };
    expect(hasReactRouterManifestRoutes()).toBe(false);

    window.__reactRouterManifest = {
      routes: {
        root: { id: "root", path: "/" },
      },
    };
    expect(hasReactRouterManifestRoutes()).toBe(true);
  });

  it("recognizes production route manifests without relying on import.meta.env", () => {
    window.__reactRouterManifest = {
      routes: {
        root: {
          id: "root",
          path: "",
          module: "/assets/root-AbC123.js",
          imports: ["/assets/vendor-DeF456.js"],
        },
        "routes/docs._index": {
          id: "routes/docs._index",
          parentId: "root",
          path: "docs",
          index: true,
          module: "/assets/docs._index-DNb8kxCk.js",
          imports: ["/assets/MarkdownRenderer-ri6QZniN.js"],
        },
      },
    };

    expect(hasWarmableRouteAssets()).toBe(true);
    expect(
      routeAssetUrlsForHref("/docs").map((href) => new URL(href).pathname),
    ).toEqual([
      "/assets/root-AbC123.js",
      "/assets/vendor-DeF456.js",
      "/assets/docs._index-DNb8kxCk.js",
      "/assets/MarkdownRenderer-ri6QZniN.js",
    ]);
  });

  it("does not warm dev source module ids from the route manifest", () => {
    window.__reactRouterManifest = {
      routes: {
        root: {
          id: "root",
          path: "",
          module: "/app/root.tsx",
          imports: ["/@fs/Users/example/app/components/Nav.tsx"],
        },
        "routes/docs._index": {
          id: "routes/docs._index",
          parentId: "root",
          path: "docs",
          index: true,
          module: "/app/routes/docs._index.tsx",
        },
      },
    };

    expect(hasWarmableRouteAssets()).toBe(false);
    expect(routeAssetUrlsForHref("/docs")).toEqual([]);
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
