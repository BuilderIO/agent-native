import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { AGENT_NATIVE_TYPEGEN_ENV } from "../shared/runtime-config.js";
import {
  findReactRouterInvocation,
  reactRouterTypegenEnv,
  usesGeneratedRouteTypes,
} from "./react-router-command.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-react-router-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  return root;
}

describe("findReactRouterInvocation", () => {
  it("runs the declared package bin with Node when no shim exists", () => {
    const root = makeRoot();
    const packageDir = path.join(root, "node_modules/@react-router/dev");
    fs.mkdirSync(path.join(packageDir, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        exports: { "./package.json": "./package.json" },
        bin: { "react-router": "bin/react-router.cjs" },
      }),
    );
    const entry = path.join(packageDir, "bin/react-router.cjs");
    fs.writeFileSync(entry, "");

    expect(findReactRouterInvocation(["build"], root)).toEqual({
      command: process.execPath,
      args: [fs.realpathSync(entry), "build"],
      shell: false,
    });
  });

  it("prefers an installed command shim", () => {
    const root = makeRoot();
    const shim = path.join(root, "node_modules/.bin/react-router");
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, "");

    expect(findReactRouterInvocation(["typegen"], root)).toEqual({
      command: shim,
      args: ["typegen"],
      shell: process.platform === "win32",
    });
  });

  it("keeps the command-name fallback when package.json is not exported", () => {
    const root = makeRoot();
    const packageDir = path.join(root, "node_modules/@react-router/dev");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        exports: {},
        bin: { "react-router": "bin.cjs" },
      }),
    );

    expect(findReactRouterInvocation(["build"], root)).toEqual({
      command: "react-router",
      args: ["build"],
      shell: process.platform === "win32",
    });
  });
});

describe("reactRouterTypegenEnv", () => {
  it("uses development mode and preserves the caller's environment", () => {
    expect(
      reactRouterTypegenEnv({ NODE_ENV: "production", DATABASE_URL: "test" }),
    ).toEqual({
      NODE_ENV: "development",
      DATABASE_URL: "test",
      [AGENT_NATIVE_TYPEGEN_ENV]: "1",
    });
  });
});

describe("usesGeneratedRouteTypes", () => {
  function appWith(files: Record<string, string>) {
    const root = makeRoot();
    for (const [relativePath, source] of Object.entries(files)) {
      const file = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, source);
    }
    return root;
  }

  it.each([
    [
      "rootDirs route types",
      "app/routes/home.tsx",
      'import type { Route } from "./+types/home";\n',
    ],
    [
      "a direct generated types path",
      "app/routes/plans.$id.tsx",
      'import type { Route } from ".react-router/types/app/routes/+types/plans.$id";\n',
    ],
    [
      "typed href",
      "shared/links.ts",
      'import {\n  Link,\n  href,\n} from "react-router";\n',
    ],
    [
      "typed useRoute",
      "app/root.tsx",
      'import { unstable_useRoute as useRoute } from "react-router";\n',
    ],
  ])("detects %s", (_label, file, source) => {
    expect(
      usesGeneratedRouteTypes(
        appWith({ "app/routes/_index.tsx": "export {};\n", [file]: source }),
      ),
    ).toBe(true);
  });

  it("ignores apps that only load the server build", () => {
    const root = appWith({
      "app/routes/_index.tsx":
        'import { useHref, useLoaderData } from "react-router";\n',
      "server/routes/[...page].get.ts":
        'export default () => import("virtual:react-router/server-build");\n',
    });

    expect(usesGeneratedRouteTypes(root)).toBe(false);
  });

  it("ignores generated, deploy, and dependency directories", () => {
    const routeTypes = 'import type { Route } from "./+types/home";\n';
    const root = appWith({
      "app/routes/_index.tsx": "export {};\n",
      ".react-router/types/app/routes/+types/home.ts": routeTypes,
      ".netlify/functions-internal/server/home.ts": routeTypes,
      "node_modules/some-package/index.ts": routeTypes,
      "app/routes/notes.md": routeTypes,
    });

    expect(usesGeneratedRouteTypes(root)).toBe(false);
  });
});
