import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { connectPreferencesPath, connectProfilesPath } from "./connect.js";
import { CLIENTS, configPathFor } from "./mcp-config-writers.js";

// vitest.setup.ts gives every test file a temporary home (vitest.isolated-home.ts).
// These fail if a config writer ever resolves outside it, for example through a
// new environment variable the setup does not redirect, which is how CLI specs
// once wrote the developer's real ~/.claude.json and ~/.codex/config.toml on Windows.

const originalHome = process.env.HOME;
const roots: string[] = [];

afterEach(() => {
  process.env.HOME = originalHome;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function inside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function userScopePaths(): string[] {
  const project = path.join(os.tmpdir(), "project-outside-home");
  return [
    ...CLIENTS.map((client) => configPathFor(client, project, "user")),
    connectPreferencesPath(),
    connectProfilesPath(),
  ];
}

describe("test home isolation", () => {
  it("starts every test file in a temporary home", () => {
    expect(inside(os.homedir(), os.tmpdir())).toBe(true);
    expect(process.env.USERPROFILE).toBe(os.homedir());
  });

  it("keeps every user-scope config the CLI writes inside that home", () => {
    for (const file of userScopePaths()) {
      expect(inside(file, os.homedir()), file).toBe(true);
    }
  });

  it("follows a spec that points HOME somewhere else, on every platform", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "an-home-isolation-"));
    roots.push(home);
    process.env.HOME = home;
    expect(os.homedir()).toBe(home);
    // APPDATA stays under the file's own temporary home, so check against the
    // temp folder, which on Windows sits inside the real profile.
    for (const file of userScopePaths()) {
      expect(inside(file, os.tmpdir()), file).toBe(true);
    }
  });
});
