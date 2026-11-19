import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  calls: [] as unknown[][],
}));

vi.mock("../vite/agent-native-config-loader.js", () => ({
  createAgentNativeConfigContext: (command: string, mode: string) => ({
    command,
    mode,
  }),
  loadResolvedAgentNativeConfig: async (...args: unknown[]) => {
    loader.calls.push(args);
    return loader.config;
  },
}));

import {
  readWorkspaceAppDisplayNames,
  resolveWorkspaceAppPaths,
} from "./workspace-app-paths.js";

const dirs: string[] = [];
function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-app-paths-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  loader.config = {};
  loader.calls = [];
});

describe("resolveWorkspaceAppPaths", () => {
  it("defaults to apps/ and includes every app", async () => {
    const root = tempRoot();
    const paths = await resolveWorkspaceAppPaths(root, {});
    expect(paths.appsDir).toBe(path.join(root, "apps"));
    expect(paths.includes("anything")).toBe(true);
    expect(loader.calls).toEqual([]);
  });

  it("uses the configured apps directory and include globs", async () => {
    const root = tempRoot();
    const paths = await resolveWorkspaceAppPaths(root, {
      deployment: {
        workspace: { appsDirectory: "packages/apps", appInclude: ["mail*"] },
      },
    } as never);
    expect(paths.appsDir).toBe(path.join(root, "packages/apps"));
    expect(paths.includes("mail")).toBe(true);
    expect(paths.includes("mailbox")).toBe(true);
    expect(paths.includes("calendar")).toBe(false);
  });

  it("includes nothing when the include list is empty", async () => {
    const paths = await resolveWorkspaceAppPaths(tempRoot(), {
      deployment: { workspace: { appInclude: [] } },
    } as never);
    expect(paths.includes("mail")).toBe(false);
  });

  it("loads the development config when none is passed", async () => {
    const root = tempRoot();
    loader.config = {
      deployment: { workspace: { appsDirectory: "workspace-apps" } },
    };
    const paths = await resolveWorkspaceAppPaths(root);
    expect(loader.calls).toEqual([
      [root, { command: "serve", mode: "development" }],
    ]);
    expect(paths.appsDir).toBe(path.join(root, "workspace-apps"));
  });
});

describe("readWorkspaceAppDisplayNames", () => {
  function writeCatalog(root: string, value: unknown) {
    const file = path.join(root, ".agent-native", "workspace-apps.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }

  it("is empty when the workspace has no catalog", () => {
    expect(readWorkspaceAppDisplayNames(tempRoot()).size).toBe(0);
  });

  it("maps app ids to their trimmed display names, skipping unusable entries", () => {
    const root = tempRoot();
    writeCatalog(root, {
      apps: [
        { id: "mail", name: "  Mail  " },
        { id: "blank", name: "   " },
        { id: "numeric", name: 7 },
        { id: 3, name: "Bad id" },
        null,
      ],
    });
    expect([...readWorkspaceAppDisplayNames(root)]).toEqual([["mail", "Mail"]]);
  });

  it("refuses a catalog without an apps array", () => {
    const root = tempRoot();
    writeCatalog(root, { apps: {} });
    expect(() => readWorkspaceAppDisplayNames(root)).toThrow(
      "Workspace app catalog must contain an apps array",
    );
  });
});
