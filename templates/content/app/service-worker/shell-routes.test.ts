import { describe, expect, it } from "vitest";

import { IMMUTABLE_ASSET_PATH } from "./shell-contract";
import {
  isShareableShellResponse,
  shellAssetReferences,
  shellBuildVersion,
} from "./shell-html";
import {
  shellBootAssets,
  shellRoutesFromManifest,
  type ReactRouterManifest,
} from "./shell-manifest";
import { matchShellRoute } from "./shell-routes";

// The shape of Content's real manifest: layouts, index routes, a splat and a
// root-level dynamic route that competes with the app's static ones.
const MANIFEST: ReactRouterManifest = {
  version: "ec4917e9",
  url: "/assets/manifest-ec4917e9.js",
  entry: {
    module: "/assets/entry.client-DYrOoKbv.js",
    imports: ["/assets/react-lCSYwAWP.js"],
  },
  routes: {
    root: {
      id: "root",
      path: "",
      module: "/assets/root-AAAAAAAA.js",
      css: ["/assets/global-CKoxiiI4.css"],
    },
    "routes/_index": { id: "routes/_index", parentId: "root", index: true },
    "routes/p.$id": { id: "routes/p.$id", parentId: "root", path: "p/:id" },
    "routes/$id": { id: "routes/$id", parentId: "root", path: ":id" },
    "routes/_app": {
      id: "routes/_app",
      parentId: "root",
      module: "/assets/_app-BBBBBBBB.js",
    },
    "routes/_app.home": {
      id: "routes/_app.home",
      parentId: "routes/_app",
      path: "home",
    },
    "routes/_app.page": {
      id: "routes/_app.page",
      parentId: "routes/_app",
      path: "page",
    },
    "routes/_app.page._index": {
      id: "routes/_app.page._index",
      parentId: "routes/_app.page",
      index: true,
    },
    "routes/_app.page.$id": {
      id: "routes/_app.page.$id",
      parentId: "routes/_app.page",
      path: ":id",
      module: "/assets/_app.page._id-CCCCCCCC.js",
      imports: ["/assets/editor-DDDDDDDD.js"],
    },
    "routes/_app.settings": {
      id: "routes/_app.settings",
      parentId: "routes/_app",
      path: "settings",
    },
    "routes/_app.settings.$": {
      id: "routes/_app.settings.$",
      parentId: "routes/_app.settings",
      path: "*",
    },
  },
};

const routes = shellRoutesFromManifest(MANIFEST);

describe("app routes", () => {
  it.each([
    ["/page/abc123", "routes/_app.page.$id", true],
    ["/page", "routes/_app.page._index", true],
    ["/home", "routes/_app.home", true],
    ["/settings", "routes/_app.settings.$", true],
    ["/settings/members/invite", "routes/_app.settings.$", true],
    ["/p/abc123", "routes/p.$id", false],
    ["/abc123", "routes/$id", false],
    ["/", "routes/_index", false],
  ])("%s matches %s", (pathname, id, app) => {
    expect(matchShellRoute(pathname, routes)).toMatchObject({ id, app });
  });

  it("matches nothing for unknown deep paths", () => {
    expect(matchShellRoute("/page/abc/extra", routes)).toBeUndefined();
  });

  it("leaves out layouts, which never end a match", () => {
    const ids = routes.map((route) => route.id);
    expect(ids).not.toContain("routes/_app");
    expect(ids).not.toContain("routes/_app.page");
    expect(ids).not.toContain("root");
  });
});

describe("boot files", () => {
  it("lists the manifest, the entry and every route's modules and CSS", () => {
    expect(shellBootAssets(MANIFEST).sort()).toEqual(
      [
        "/assets/manifest-ec4917e9.js",
        "/assets/entry.client-DYrOoKbv.js",
        "/assets/react-lCSYwAWP.js",
        "/assets/root-AAAAAAAA.js",
        "/assets/global-CKoxiiI4.css",
        "/assets/_app-BBBBBBBB.js",
        "/assets/_app.page._id-CCCCCCCC.js",
        "/assets/editor-DDDDDDDD.js",
      ].sort(),
    );
  });

  it("only treats content-hashed files as immutable", () => {
    expect(IMMUTABLE_ASSET_PATH.test("/assets/sw-build-ec4917e9.json")).toBe(
      true,
    );
    expect(IMMUTABLE_ASSET_PATH.test("/assets/katex.min-Cp579UoJ.css")).toBe(
      true,
    );
    expect(IMMUTABLE_ASSET_PATH.test("/favicon.svg")).toBe(false);
    expect(IMMUTABLE_ASSET_PATH.test("/assets/library-presets.json")).toBe(
      false,
    );
  });
});

describe("shell HTML", () => {
  const html =
    `<link rel="modulepreload" href="/assets/manifest-ec4917e9.js"/>` +
    `<link rel="stylesheet" href="/assets/global-CKoxiiI4.css"/>` +
    `<link rel="icon" href="/favicon.svg"/>` +
    `<script type="module">import "/assets/manifest-ec4917e9.js";` +
    `import("/assets/entry.client-DYrOoKbv.js");</script>`;

  it("names its build by React Router's manifest version", () => {
    expect(shellBuildVersion(html)).toBe("ec4917e9");
    expect(shellBuildVersion("<html></html>")).toBeUndefined();
  });

  it("lists the hashed files it loads", () => {
    expect(shellAssetReferences(html).sort()).toEqual(
      [
        "/assets/manifest-ec4917e9.js",
        "/assets/global-CKoxiiI4.css",
        "/assets/entry.client-DYrOoKbv.js",
      ].sort(),
    );
  });

  function response(headers: Record<string, string>, init: ResponseInit = {}) {
    return new Response("<html></html>", {
      status: 200,
      ...init,
      headers: { "content-type": "text/html; charset=utf-8", ...headers },
    });
  }

  it("is shareable when the server marks it public, as SSR does", () => {
    expect(
      isShareableShellResponse(
        response({
          "cache-control":
            "public,max-age=600,stale-while-revalidate=604800,stale-if-error=3600",
          vary: "Accept-Encoding",
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["no cache-control", {}, {}],
    ["private", { "cache-control": "public, private" }, {}],
    ["no-store", { "cache-control": "no-store" }, {}],
    ["no-cache", { "cache-control": "public, no-cache" }, {}],
    ["vary cookie", { "cache-control": "public", vary: "Cookie" }, {}],
    ["vary *", { "cache-control": "public", vary: "*" }, {}],
    ["an error page", { "cache-control": "public" }, { status: 404 }],
    [
      "JSON",
      { "cache-control": "public", "content-type": "application/json" },
      {},
    ],
  ])("is not shareable with %s", (_label, headers, init) => {
    expect(isShareableShellResponse(response(headers, init))).toBe(false);
  });
});
