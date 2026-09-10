import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clack = vi.hoisted(() => ({
  cancel: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
}));

vi.mock("@clack/prompts", () => clack);

import { addAppToWorkspace } from "./create.js";
import { coreTemplates } from "./templates-meta.js";

let originalCwd: string;
let workspaceRoot: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-add-app-test-"),
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      "agent-native": { workspaceCore: "@test/shared" },
    }),
  );
  fs.mkdirSync(path.join(workspaceRoot, "apps"));
  process.chdir(workspaceRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code ?? 0})`);
  });
}

describe("workspace add-app selection feedback", () => {
  it("explains how to select an app when the picker is submitted empty", async () => {
    clack.multiselect.mockResolvedValueOnce([]);
    const exit = mockExit();

    await expect(addAppToWorkspace()).rejects.toThrow("process.exit(0)");

    expect(clack.multiselect).toHaveBeenCalledOnce();
    expect(clack.cancel).toHaveBeenCalledWith(
      "No apps selected. Press space to select an app, then press enter to continue.",
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("reports when every available app is already installed", async () => {
    for (const template of coreTemplates()) {
      fs.mkdirSync(path.join(workspaceRoot, "apps", template.name));
    }
    const exit = mockExit();

    await expect(addAppToWorkspace()).rejects.toThrow("process.exit(0)");

    expect(clack.multiselect).not.toHaveBeenCalled();
    expect(clack.cancel).toHaveBeenCalledWith(
      "All available apps are already installed.",
    );
    expect(exit).toHaveBeenCalledWith(0);
  });
});
