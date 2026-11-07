import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scaffoldWorkspaceAppFromTemplate } from "./app-creation-store.js";

// Scaffolding runs the `agent-native add-app` CLI as a child process, and when
// it fails the app directory it left behind is removed. Each of those writes
// reports itself before it runs, so the framework can tell the call wrote.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  spawn: vi.fn(),
  getSetting: vi.fn(async (_key: string): Promise<unknown> => null),
  putSetting: vi.fn(async () => {}),
  mutateSetting: vi.fn(async () => null),
  getOrgSetting: vi.fn(
    async (_orgId: string, _key: string): Promise<unknown> => null,
  ),
  execute: vi.fn(async () => ({ rows: [] as unknown[], rowsAffected: 0 })),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: (...args: unknown[]) => mocks.spawn(...args),
}));

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: mocks.getSetting,
  putSetting: mocks.putSetting,
  mutateSetting: mocks.mutateSetting,
  getOrgSetting: mocks.getOrgSetting,
}));

const ORG_ID = "org-123";
const METADATA_KEY = "workspace-app-metadata:org:org-123";

const roots: string[] = [];
const spies: { mockRestore: () => void }[] = [];

class FakeCli extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn();
}

/** The position, within the whole run, of a spy's index-th call. */
function callOrder(
  spy: { mock: { invocationCallOrder: number[] } },
  index = 0,
): number {
  const order = spy.mock.invocationCallOrder[index];
  if (order === undefined) {
    throw new Error(`Expected call ${index} to be recorded.`);
  }
  return order;
}

/** A workspace root that `findWorkspaceRoot` finds from the process cwd. */
function workspace(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "dispatch-scaffold-observed-"),
  );
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "workspace",
      "agent-native": { workspaceCore: "@agent-native/core" },
    }),
  );
  spies.push(vi.spyOn(process, "cwd").mockReturnValue(root));
  return root;
}

function observeRemovals() {
  const spy = vi.spyOn(fs, "rmSync");
  spies.push(spy);
  return spy;
}

/** Stands in for `pnpm exec agent-native`: runs `beforeExit`, then exits. */
function fakeCli(input: {
  code: number;
  stderr?: string;
  beforeExit?: () => void;
}): void {
  mocks.spawn.mockImplementation(() => {
    const child = new FakeCli();
    setImmediate(() => {
      input.beforeExit?.();
      if (input.stderr) child.stderr.emit("data", input.stderr);
      child.emit("exit", input.code);
    });
    return child;
  });
}

function scaffold() {
  return runWithRequestContext(
    { userEmail: "dev@example.test", orgId: ORG_ID },
    () => scaffoldWorkspaceAppFromTemplate({ template: "mail" }),
  );
}

beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation(() => {
    throw new Error("Unexpected CLI spawn in the scaffold write spec.");
  });
  mocks.getSetting.mockReset();
  mocks.getSetting.mockResolvedValue(null);
  mocks.getOrgSetting.mockReset();
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.execute.mockReset();
  mocks.execute.mockResolvedValue({ rows: [], rowsAffected: 0 });
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

describe("scaffoldWorkspaceAppFromTemplate write observation", () => {
  it("notes the child-process write before the scaffold CLI spawns", async () => {
    const root = workspace();
    fakeCli({ code: 1, stderr: "boom" });
    const rmSync = observeRemovals();

    await expect(scaffold()).rejects.toThrow("Scaffold failed: boom");

    expect(mocks.spawn).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "agent-native", "add-app", "mail", "--template", "mail"],
      expect.objectContaining({ cwd: root }),
    );
    expect(mocks.noteExternalWrite).toHaveBeenCalledTimes(1);
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("child-process");
    expect(callOrder(mocks.noteExternalWrite)).toBeLessThan(
      callOrder(mocks.spawn),
    );
    expect(rmSync).not.toHaveBeenCalled();
  });

  it("notes the local-disk write before removing a half-made app when the CLI fails", async () => {
    const root = workspace();
    const appDir = path.join(root, "apps", "mail");
    fakeCli({
      code: 1,
      stderr: "boom",
      beforeExit: () => {
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, "package.json"), "{}");
      },
    });
    const rmSync = observeRemovals();

    await expect(scaffold()).rejects.toThrow("Scaffold failed: boom");

    expect(mocks.noteExternalWrite).toHaveBeenNthCalledWith(2, "local-disk");
    expect(rmSync).toHaveBeenCalledWith(appDir, {
      recursive: true,
      force: true,
    });
    expect(callOrder(mocks.noteExternalWrite, 1)).toBeLessThan(
      callOrder(rmSync),
    );
    expect(fs.existsSync(appDir)).toBe(false);
  });

  it("notes the local-disk write before removing the app when its metadata write fails", async () => {
    const root = workspace();
    const appDir = path.join(root, "apps", "mail");
    fakeCli({
      code: 0,
      beforeExit: () => {
        fs.mkdirSync(appDir, { recursive: true });
      },
    });
    mocks.getSetting.mockImplementation(async (key: string) => {
      if (key === METADATA_KEY) {
        throw new Error("metadata store unavailable");
      }
      return null;
    });
    const rmSync = observeRemovals();

    await expect(scaffold()).rejects.toThrow("metadata store unavailable");

    expect(mocks.noteExternalWrite).toHaveBeenNthCalledWith(2, "local-disk");
    expect(rmSync).toHaveBeenCalledWith(appDir, {
      recursive: true,
      force: true,
    });
    expect(callOrder(mocks.noteExternalWrite, 1)).toBeLessThan(
      callOrder(rmSync),
    );
    expect(fs.existsSync(appDir)).toBe(false);
  });
});
