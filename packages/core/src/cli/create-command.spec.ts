import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runCreateWizard } = vi.hoisted(() => ({
  runCreateWizard: vi.fn(),
}));

vi.mock("./create-tui.js", () => ({
  runCreateWizard,
  promptInkChoice: vi.fn(),
}));

import { runCreateCommand } from "./create.js";

let originalCwd: string;
let workspaceRoot: string;
let stdinTtyDescriptor: PropertyDescriptor | undefined;
let stdoutTtyDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalCwd = process.cwd();
  stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
    process.stdout,
    "isTTY",
  );
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-create-command-test-"),
  );
  fs.mkdirSync(path.join(workspaceRoot, "apps"));
  fs.writeFileSync(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "existing-workspace",
      "agent-native": { workspaceCore: "@existing/shared" },
    }),
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "pnpm-workspace.yaml"),
    'packages:\n  - "apps/*"\n',
  );
  process.chdir(workspaceRoot);
  runCreateWizard.mockImplementation(async (options) => ({
    kind: "workspace-add",
    templates: ["forms"],
    addToWorkspace: options.addToWorkspace,
  }));
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  if (stdinTtyDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
  } else {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
  if (stdoutTtyDescriptor) {
    Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
  } else {
    Reflect.deleteProperty(process.stdout, "isTTY");
  }
  vi.clearAllMocks();
});

describe("create command wizard routing", () => {
  it("routes first-party workspace selections directly into the existing workspace", async () => {
    await runCreateCommand();

    expect(runCreateWizard).toHaveBeenCalledWith(
      expect.objectContaining({
        initialKind: "workspace-add",
        addToWorkspace: true,
      }),
    );
    expect(
      fs.existsSync(path.join(workspaceRoot, "apps", "forms", "package.json")),
    ).toBe(true);
  });
});
