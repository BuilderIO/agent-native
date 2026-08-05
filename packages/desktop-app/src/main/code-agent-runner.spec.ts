import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dispatchCodeAgentRunnerCommand } from "./code-agent-runner-dispatch.js";
import {
  resolveCodeAgentRunnerInvocation,
  runCodeAgentRunnerWithSignal,
} from "./code-agent-runner.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveCodeAgentRunnerInvocation", () => {
  it.each(["run", "approve", "approve-always", "deny"] as const)(
    "uses the bundled runtime for a packaged %s command",
    (subcommand) => {
      const root = createTempRoot();
      const resourcesPath = path.join(
        root,
        "Agent Native.app",
        "Contents",
        "Resources",
      );
      const repoRoot = path.join(root, "source-checkout");
      const electronPath = path.join(
        root,
        "Agent Native.app",
        "Contents",
        "MacOS",
        "Agent Native",
      );
      const runId = "task-20260719-abcdef01";

      const invocation = resolveCodeAgentRunnerInvocation(
        {
          appIsPackaged: true,
          resourcesPath,
          electronPath,
          repoRoot,
        },
        subcommand,
        runId,
      );

      expect(invocation).toEqual({
        command: electronPath,
        args: [
          path.join(
            resourcesPath,
            "app.asar",
            "out",
            "main",
            "code-agent-runner-entry.js",
          ),
          subcommand,
          runId,
        ],
        cwd: resourcesPath,
        env: { ELECTRON_RUN_AS_NODE: "1" },
      });
      expect(JSON.stringify(invocation)).not.toContain(repoRoot);
      expect(invocation.command).not.toBe("node");
      expect(invocation.command).not.toBe("pnpm");
    },
  );

  it("uses the built core CLI when development artifacts are available", () => {
    const repoRoot = createTempRoot();
    const localCli = path.join(repoRoot, "packages/core/dist/cli/index.js");
    fs.mkdirSync(path.dirname(localCli), { recursive: true });
    fs.writeFileSync(localCli, "");

    expect(
      resolveCodeAgentRunnerInvocation(
        {
          appIsPackaged: false,
          resourcesPath: "/ignored/resources",
          electronPath: "/ignored/electron",
          repoRoot,
        },
        "run",
        "task-1",
      ),
    ).toEqual({
      command: "node",
      args: ["packages/core/dist/cli/index.js", "code", "run", "task-1"],
      cwd: repoRoot,
    });
  });

  it("preserves the pnpm development fallback when core has not been built", () => {
    const repoRoot = createTempRoot();

    expect(
      resolveCodeAgentRunnerInvocation(
        {
          appIsPackaged: false,
          resourcesPath: "/ignored/resources",
          electronPath: "/ignored/electron",
          repoRoot,
        },
        "approve-always",
        "task-2",
      ),
    ).toEqual({
      command: "pnpm",
      args: [
        "--filter",
        "@agent-native/core",
        "exec",
        "node",
        "dist/cli/index.js",
        "code",
        "approve-always",
        "task-2",
      ],
      cwd: repoRoot,
    });
  });
});

describe("runCodeAgentRunnerWithSignal", () => {
  it("forwards SIGTERM to the executor and removes signal listeners after it settles", async () => {
    const processRef = new EventEmitter();
    let started!: () => void;
    const startedExecution = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedSignal: AbortSignal | undefined;

    const execution = runCodeAgentRunnerWithSignal(
      processRef,
      async (signal) => {
        observedSignal = signal;
        started();
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return "stopped";
      },
    );

    await startedExecution;
    processRef.emit("SIGTERM");

    await expect(execution).resolves.toBe("stopped");
    expect(observedSignal?.aborted).toBe(true);
    expect(processRef.listenerCount("SIGTERM")).toBe(0);
    expect(processRef.listenerCount("SIGINT")).toBe(0);
  });
});

describe("dispatchCodeAgentRunnerCommand", () => {
  it("forwards an aborted signal through the deny dispatch", async () => {
    const controller = new AbortController();
    controller.abort();
    const deny = async (_runId: string, options: { signal: AbortSignal }) =>
      options.signal.aborted ? "paused" : "errored";
    let result: unknown;

    await dispatchCodeAgentRunnerCommand(
      ["deny", "task-1"],
      { stdout: process.stdout, signal: controller.signal },
      {
        run: async () => undefined,
        approve: async () => undefined,
        approveAlways: async () => undefined,
        deny: async (runId, options) => {
          result = await deny(runId, options);
        },
      },
    );

    expect(result).toBe("paused");
  });
});

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-code-runner-"));
  tempRoots.push(root);
  return root;
}
