import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Component workspaces write under the user's repo, so each write reports
// itself as a local-file write before it creates folders or files.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

import {
  localComponentWorkspaceStorePath,
  registerLocalComponentWorkspace,
  writeLocalComponentFile,
} from "./local-component-workspaces";

const tmpRoots: string[] = [];

function mkdtemp(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

function workspaceWithComponent() {
  const cwd = mkdtemp("an-content-note-cwd-");
  const workspace = mkdtemp("an-content-note-workspace-");
  fs.mkdirSync(path.join(workspace, "components"));
  fs.writeFileSync(
    path.join(workspace, "components", "ImpactCounter.tsx"),
    "export function ImpactCounter() { return null; }\n",
    "utf8",
  );
  return { cwd, workspace };
}

beforeEach(() => {
  mocks.noteExternalWrite.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function callOrder(spy: { mock: { invocationCallOrder: number[] } }): number {
  const order = spy.mock.invocationCallOrder.at(0);
  if (order === undefined) {
    throw new Error("Expected the spy to be called.");
  }
  return order;
}

describe("local component workspaces write observation", () => {
  it("notes a local-file write before the workspace store is written", async () => {
    const { cwd, workspace } = workspaceWithComponent();
    const writeFile = vi.spyOn(fsp, "writeFile");

    await registerLocalComponentWorkspace({ cwd, workspacePath: workspace });

    expect(writeFile).toHaveBeenCalledWith(
      localComponentWorkspaceStorePath(cwd),
      expect.any(String),
      "utf8",
    );
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-file");
    expect(callOrder(mocks.noteExternalWrite)).toBeLessThan(
      callOrder(writeFile),
    );
  });

  it("notes nothing when the workspace is already registered unchanged", async () => {
    const { cwd, workspace } = workspaceWithComponent();
    await registerLocalComponentWorkspace({ cwd, workspacePath: workspace });
    mocks.noteExternalWrite.mockClear();
    const writeFile = vi.spyOn(fsp, "writeFile");

    await registerLocalComponentWorkspace({ cwd, workspacePath: workspace });

    expect(writeFile).not.toHaveBeenCalled();
    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
  });

  it("notes a local-file write before a component folder and file are created", async () => {
    const { cwd, workspace } = workspaceWithComponent();
    const { workspace: registered } = await registerLocalComponentWorkspace({
      cwd,
      workspacePath: workspace,
    });
    mocks.noteExternalWrite.mockClear();
    const mkdir = vi.spyOn(fsp, "mkdir");
    const writeFile = vi.spyOn(fsp, "writeFile");

    await writeLocalComponentFile({
      cwd,
      workspaceId: registered.id,
      filePath: "Nested/Callout.tsx",
      content: "export function Callout() { return null; }\n",
    });

    expect(mkdir).toHaveBeenCalled();
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-file");
    const noted = callOrder(mocks.noteExternalWrite);
    expect(noted).toBeLessThan(callOrder(mkdir));
    expect(noted).toBeLessThan(callOrder(writeFile));
  });
});
