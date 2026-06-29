import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverDesignRoutes,
  parseDesignConnectArgs,
  prepareDesignConnectManifest,
} from "./design-connect.js";

const tmpRoots: string[] = [];

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-design-cli-"));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("design connect CLI", () => {
  it("parses connect flags", () => {
    expect(
      parseDesignConnectArgs([
        "connect",
        "--url",
        "localhost:5173",
        "--port",
        "7555",
        "--root",
        "/tmp/app",
        "--json",
      ]),
    ).toMatchObject({
      url: "http://localhost:5173",
      port: 7555,
      root: "/tmp/app",
      json: true,
      once: true,
    });
  });

  it("discovers React Router route files without AST parsing", () => {
    const root = tmpDir();
    const routes = path.join(root, "app", "routes");
    fs.mkdirSync(routes, { recursive: true });
    fs.writeFileSync(path.join(routes, "_index.tsx"), "export default null;");
    fs.writeFileSync(
      path.join(routes, "_app.settings.tsx"),
      "export default null;",
    );
    fs.writeFileSync(
      path.join(routes, "design.$id.tsx"),
      "export default null;",
    );
    fs.writeFileSync(
      path.join(routes, "design-systems_.setup.tsx"),
      "export default null;",
    );
    fs.writeFileSync(path.join(routes, "$.tsx"), "export default null;");

    expect(discoverDesignRoutes(root)).toEqual([
      {
        id: "route-root",
        path: "/",
        title: "Home",
        sourceFile: "app/routes/_index.tsx",
        sourceKind: "react-router",
      },
      {
        id: "route-wildcard",
        path: "/*",
        title: "Wildcard",
        sourceFile: "app/routes/$.tsx",
        sourceKind: "react-router",
      },
      {
        id: "route-design-systems-setup",
        path: "/design-systems/setup",
        title: "Design Systems Setup",
        sourceFile: "app/routes/design-systems_.setup.tsx",
        sourceKind: "react-router",
      },
      {
        id: "route-design-id",
        path: "/design/:id",
        title: "Design Id",
        sourceFile: "app/routes/design.$id.tsx",
        sourceKind: "react-router",
      },
      {
        id: "route-settings",
        path: "/settings",
        title: "Settings",
        sourceFile: "app/routes/_app.settings.tsx",
        sourceKind: "react-router",
      },
    ]);
  });

  it("scaffolds a route manifest without overwriting an existing one", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "app", "routes"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "app", "routes", "_index.tsx"),
      "export default null;",
    );

    const first = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port: 7666,
    });
    expect(first.bridgeUrl).toBe("http://127.0.0.1:7666");
    expect(first.routeManifestCreated).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".agent-native/design-routes.json")),
    ).toBe(true);

    fs.writeFileSync(first.routeManifestPath, '{"keep":true}\n', "utf8");
    const second = await prepareDesignConnectManifest({
      root,
      url: "http://localhost:5173",
      port: 7666,
    });
    expect(second.routeManifestCreated).toBe(false);
    expect(fs.readFileSync(first.routeManifestPath, "utf8")).toBe(
      '{"keep":true}\n',
    );
  });
});
