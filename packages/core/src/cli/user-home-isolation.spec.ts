import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isolateUserHome } from "../../vitest.isolated-home";
import { remoteDeviceConfigPath } from "./code-agent-connector.js";
import { codeAgentStoreRoot } from "./code-agent-runs.js";
import { connectPreferencesPath, connectProfilesPath } from "./connect.js";
import { CLIENTS, configPathFor } from "./mcp-config-writers.js";
import { planPublishConfigPath } from "./plan-publish-store.js";

// vitest.setup.ts gives every test file a temporary home (vitest.isolated-home.ts).
// CLI specs once wrote the developer's real ~/.claude.json and ~/.codex/config.toml
// on Windows, where os.homedir() ignores HOME. These fail if a user-scope path the
// CLI writes, listed in userScopePaths, resolves outside that home, including when
// the developer's shell sets one of the writers' path overrides. A new writer
// needs adding to userScopePaths to be covered.

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
    planPublishConfigPath(),
    codeAgentStoreRoot(),
    remoteDeviceConfigPath(),
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

  it("ignores path overrides inherited from the developer's shell", () => {
    const outside = path.join(
      path.parse(os.tmpdir()).root,
      "real-home-stand-in",
    );
    const overrides = {
      CODEX_HOME: path.join(outside, ".codex"),
      CLAUDE_CONFIG_DIR: path.join(outside, ".claude"),
      XDG_CONFIG_HOME: path.join(outside, ".config"),
      PLAN_PUBLISH_CONFIG_PATH: path.join(outside, "plan-publish.json"),
      AGENT_NATIVE_CODE_AGENTS_HOME: path.join(outside, "code-agents"),
      AGENT_NATIVE_REMOTE_DEVICE_PATH: path.join(outside, "remote-device.json"),
    };
    const previous = Object.fromEntries(
      Object.keys(overrides).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, overrides);
    const isolated = isolateUserHome();
    try {
      for (const file of userScopePaths()) {
        expect(inside(file, isolated.home), file).toBe(true);
      }
    } finally {
      isolated.restore();
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
