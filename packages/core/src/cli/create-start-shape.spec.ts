import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clack = vi.hoisted(() => ({
  cancel: vi.fn(),
  intro: vi.fn(),
  isCancel: vi.fn(() => false),
  note: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn(() => ({
    message: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("@clack/prompts", () => clack);

import { addAppToWorkspace, createApp, detectWorkspace } from "./create.js";

let originalCwd: string;
let parentDir: string;

beforeEach(() => {
  originalCwd = process.cwd();
  parentDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-start-shape-test-"),
  );
  process.chdir(parentDir);
  clack.select.mockResolvedValueOnce("chat");
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(parentDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("interactive create start shapes", () => {
  it("creates a Chat workspace that accepts add-app", async () => {
    await createApp("my-platform");

    const workspaceRoot = path.join(parentDir, "my-platform");
    const workspace = detectWorkspace(workspaceRoot);

    expect(workspace).toEqual({
      workspaceRoot,
      workspaceCoreName: "@my-platform/shared",
    });
    expect(
      fs.existsSync(path.join(workspaceRoot, "apps", "chat", "package.json")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceRoot, "apps", "dispatch", "package.json"),
      ),
    ).toBe(true);

    process.chdir(workspaceRoot);
    await addAppToWorkspace("forms", { template: "forms" });

    expect(
      fs.existsSync(path.join(workspaceRoot, "apps", "forms", "package.json")),
    ).toBe(true);
  });
});
