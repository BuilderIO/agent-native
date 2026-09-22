import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { findReactRouterInvocation } from "./react-router-command.js";

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
