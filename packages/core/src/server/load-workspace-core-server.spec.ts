import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWorkspaceCoreServer } from "./framework-request-handler.js";

describe("loadWorkspaceCoreServer", () => {
  let tmpRoot: string;
  let pkgDir: string;
  const pkgName = "@an-test/workspace-core-fixture";

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "an-ws-core-"));
    pkgDir = path.join(tmpRoot, "packages", "workspace-core");
    mkdirSync(path.join(pkgDir, "src", "server"), { recursive: true });

    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: pkgName,
          private: true,
          version: "0.0.0",
          type: "module",
          exports: {
            "./server": {
              types: "./src/server/index.ts",
              default: "./src/server/index.ts",
            },
          },
        },
        null,
        2,
      ),
    );

    writeFileSync(
      path.join(pkgDir, "src", "server", "index.ts"),
      `export { authPlugin } from "./auth-plugin.js";\n` +
        `export { agentChatPlugin } from "./agent-chat-plugin.js";\n`,
    );
    writeFileSync(
      path.join(pkgDir, "src", "server", "auth-plugin.ts"),
      `export const authPlugin = (n: unknown) => "auth:" + String(n);\n`,
    );
    writeFileSync(
      path.join(pkgDir, "src", "server", "agent-chat-plugin.ts"),
      `export const agentChatPlugin = (n: unknown) => "chat:" + String(n);\n`,
    );

    const scopeDir = path.join(tmpRoot, "node_modules", "@an-test");
    mkdirSync(scopeDir, { recursive: true });
    symlinkSync(pkgDir, path.join(scopeDir, "workspace-core-fixture"), "dir");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves TS source workspace-core /server entries", async () => {
    const mod = await loadWorkspaceCoreServer(pkgName, pkgDir);
    expect(typeof mod.authPlugin).toBe("function");
    expect(typeof mod.agentChatPlugin).toBe("function");
    expect(mod.authPlugin("x")).toBe("auth:x");
    expect(mod.agentChatPlugin("y")).toBe("chat:y");
  });

  it("propagates non-TS-resolution errors instead of swallowing them", async () => {
    await expect(
      loadWorkspaceCoreServer(
        "@an-test/this-package-does-not-exist",
        path.join(tmpRoot, "nope"),
      ),
    ).rejects.toThrow();
  });
});
