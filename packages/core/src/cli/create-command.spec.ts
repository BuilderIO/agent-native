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
  vi.restoreAllMocks();
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

  it("preserves a nameless Dispatch selection as a first-party workspace", async () => {
    const standaloneCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-create-command-standalone-"),
    );
    process.chdir(standaloneCwd);
    runCreateWizard.mockResolvedValueOnce(null);

    try {
      await runCreateCommand(undefined, { template: "dispatch" });

      expect(runCreateWizard).toHaveBeenCalledWith(
        expect.objectContaining({
          initialKind: "first-party",
          initialTemplates: ["dispatch"],
        }),
      );
    } finally {
      process.chdir(workspaceRoot);
      fs.rmSync(standaloneCwd, { recursive: true, force: true });
    }
  });

  it("allows a fully specified community template through the non-TTY path", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    fs.mkdirSync(path.join(workspaceRoot, "apps", "sample-app"));
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code ?? 0})`);
    });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runCreateCommand("sample-app", {
        template: "community:acme/portal",
      }),
    ).rejects.toThrow("process.exit(1)");

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).not.toHaveBeenCalledWith(
      expect.stringContaining("An interactive terminal is needed"),
    );
    expect(runCreateWizard).not.toHaveBeenCalled();
  });
});

describe("create command activation report", () => {
  // The report is one record per process, so each test gets its own.
  async function freshRun() {
    vi.resetModules();
    const { runCreateCommand: run } = await import("./create.js");
    const activation = await import("./activation-telemetry.js");
    return { run, activation };
  }

  it("reports a closed wizard as cancelled", async () => {
    const { run, activation } = await freshRun();
    runCreateWizard.mockResolvedValueOnce(null);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await run();
    activation.noteCreateReturned();

    expect(activation.createFinishedProperties(0).outcome).toBe("cancelled");
  });

  it("reports an app added to a workspace as completed", async () => {
    const { run, activation } = await freshRun();

    await run();
    activation.noteCreateReturned();

    expect(activation.createFinishedProperties(0)).toEqual({
      outcome: "completed",
      templates: "forms",
      projectKind: "workspace-add",
    });
  });

  it("never reports a community template's address", async () => {
    const { run, activation } = await freshRun();
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    fs.mkdirSync(path.join(workspaceRoot, "apps", "sample-app"));
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code ?? 0})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      run("sample-app", { template: "community:acme/portal" }),
    ).rejects.toThrow("process.exit(1)");

    const properties = activation.createFinishedProperties(1);
    expect(properties).toMatchObject({
      outcome: "failed",
      templates: "community",
    });
    expect(JSON.stringify(properties)).not.toContain("acme");
  });
});
