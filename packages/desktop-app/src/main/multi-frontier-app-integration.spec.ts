import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionStatus } from "../../shared/subscription-status.js";
import type { CodexSubscriptionAdapter } from "./codex-subscription.js";
import type { MultiFrontierIpcMain } from "./ipc/multi-frontier.js";
import {
  captureImmutableWorkspaceSnapshot,
  createMultiFrontierQuitGuard,
  createRegisteredWorkspaceResolver,
  initializeMultiFrontierAppIntegration,
  type GitCommandResult,
  type RunGitCommand,
} from "./multi-frontier-app-integration.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("multi-frontier app integration", () => {
  it("maps renderer cwd requests only to registered Code Agent workspace ids", () => {
    const resolver = createRegisteredWorkspaceResolver({
      listWorkspaces: () => ({
        selectedPath: "/safe/one",
        workspaces: [
          { id: "project-one", path: "/safe/one" },
          { id: "project-two", path: "/safe/two" },
        ],
      }),
      resolveDirectory: (value) =>
        typeof value === "string" && value.startsWith("/safe/") ? value : null,
    });

    expect(resolver.resolveRequested(undefined)).toBe("project-one");
    expect(resolver.resolveRequested("/safe/two")).toBe("project-two");
    expect(resolver.resolveRequested("/renderer/untrusted")).toBeNull();
    expect(resolver.resolveId("project-two")).toBe("/safe/two");
    expect(resolver.resolveId("/safe/two")).toBeNull();
  });

  it("pauses recovered runs before any provider process starts, shares one Codex adapter, and unregisters on disposal", async () => {
    const ipc = createIpc();
    const codex = createCodexAdapter();
    const pauseRecoveredRuns = vi.fn(() => [{ collaborationId: "mf-1" }]);
    const integration = initializeMultiFrontierAppIntegration({
      ipcMain: ipc.ipcMain,
      storeRoot: root(),
      loginCwd: "/safe/project",
      listWorkspaces: () => ({
        selectedPath: "/safe/project",
        workspaces: [{ id: "project-1", path: "/safe/project" }],
      }),
      resolveDirectory: (value) => (typeof value === "string" ? value : null),
      createCodexAdapter: () => codex.adapter,
      readClaudeStatus: async () => claudeStatus(),
      pauseRecoveredRuns,
    });

    expect(integration.codex).toBe(codex.adapter);
    expect(integration.recoveredCount).toBe(1);
    expect(pauseRecoveredRuns).toHaveBeenCalledOnce();
    expect(codex.start).not.toHaveBeenCalled();

    await integration.host.getProviderStatus("codex");
    expect(codex.start).toHaveBeenCalledOnce();
    await integration.dispose();
    await integration.dispose();

    expect(codex.stop).toHaveBeenCalledOnce();
    expect(ipc.removeHandler).toHaveBeenCalled();
  });

  it("holds Electron quit until multi-frontier disposal settles, then reissues once", async () => {
    let settle: () => void = () => undefined;
    const dispose = vi.fn(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );
    const reissueQuit = vi.fn();
    const guard = createMultiFrontierQuitGuard({ dispose, reissueQuit });
    const event = { preventDefault: vi.fn() };

    expect(guard(event)).toBe(true);
    expect(guard(event)).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    settle();
    await Promise.resolve();
    await Promise.resolve();

    expect(reissueQuit).toHaveBeenCalledOnce();
    expect(guard(event)).toBe(false);
  });

  it("stores an immutable private patch with actual diff-check evidence and no all-zero hash", async () => {
    const workspace = root();
    fs.writeFileSync(
      path.join(workspace, "untracked.ts"),
      "export const added = true;\n",
    );
    const snapshot = await captureImmutableWorkspaceSnapshot({
      cwd: workspace,
      workspaceId: "project-1",
      storeRoot: workspace,
      runGit: git({
        "rev-parse HEAD": result("abc123\n"),
        "status --short": result(" M tracked.ts\n?? untracked.ts\n"),
        "diff --stat": result(" tracked.ts | 1 +\n"),
        "diff --check": result(),
        "diff --binary --no-ext-diff --": result(
          "diff --git a/tracked.ts b/tracked.ts\n+line\n",
        ),
        "ls-files --others --exclude-standard -z": result("untracked.ts\0"),
        [`diff --no-index --binary -- ${nullDevice()} untracked.ts`]: result(
          "diff --git a/untracked.ts b/untracked.ts\n+export const added = true;\n",
          "",
          1,
        ),
      }),
    });

    expect(snapshot.contentRef).toMatch(/^file:\//);
    expect(snapshot.contentHash).not.toBe("0".repeat(64));
    expect(snapshot.testOutput).toBe(
      "Checks 1 passed. git diff --check found no errors.",
    );
    const contentPath = snapshot.contentRef.slice("file:".length);
    const content = fs.readFileSync(contentPath, "utf8");
    expect(content).toContain("diff --git a/tracked.ts b/tracked.ts");
    expect(content).toContain("diff --git a/untracked.ts b/untracked.ts");
    expect(content).toContain("git diff --check exit=0");
    expect(createHash("sha256").update(content).digest("hex")).toBe(
      snapshot.contentHash,
    );
    expect(fs.statSync(contentPath).mode & 0o777).toBe(0o600);
  });

  it("fails closed before creating a blob when a patch exceeds the cap", async () => {
    const workspace = root();
    await expect(
      captureImmutableWorkspaceSnapshot({
        cwd: workspace,
        workspaceId: "project-1",
        storeRoot: workspace,
        runGit: git({
          "diff --binary --no-ext-diff --": {
            ...result("x".repeat(256 * 1024 + 1)),
            overflow: true,
          },
        }),
      }),
    ).rejects.toThrow("checkpoint");
    expect(
      fs.existsSync(path.join(workspace, "multi-frontier-checkpoints")),
    ).toBe(false);
  });

  it("reports a failed diff check as failed completion evidence", async () => {
    const workspace = root();
    const snapshot = await captureImmutableWorkspaceSnapshot({
      cwd: workspace,
      workspaceId: "project-1",
      storeRoot: workspace,
      runGit: git({
        "diff --check": result("tracked.ts:1: trailing whitespace\n", "", 2),
      }),
    });

    expect(snapshot.testOutput).toContain("Checks 1 failed");
    expect(snapshot.testOutput).toContain("trailing whitespace");
  });
});

function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "multi-frontier-app-"));
  roots.push(value);
  return value;
}

function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function result(stdout = "", stderr = "", exitCode = 0): GitCommandResult {
  return { stdout, stderr, exitCode };
}

function git(results: Record<string, GitCommandResult>): RunGitCommand {
  return async (_cwd, args) => results[args.join(" ")] ?? result();
}

function createIpc(): {
  ipcMain: MultiFrontierIpcMain;
  removeHandler: ReturnType<typeof vi.fn>;
} {
  const removeHandler = vi.fn();
  return {
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler,
      removeListener: vi.fn(),
    },
    removeHandler,
  };
}

function createCodexAdapter(): {
  adapter: CodexSubscriptionAdapter;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const status = codexStatus();
  const start = vi.fn(async () => status);
  const stop = vi.fn();
  return {
    adapter: {
      start,
      refresh: start,
      getStatus: () => status,
      subscribe: (listener: (status: SubscriptionStatus) => void) => {
        listener(status);
        return () => undefined;
      },
      stop,
    } as unknown as CodexSubscriptionAdapter,
    start,
    stop,
  };
}

function codexStatus(): SubscriptionStatus {
  return {
    schemaVersion: 1,
    providerId: "codex",
    connectionState: "connected",
    authMethod: "ChatGPT",
    telemetry: {
      state: "unavailable",
      source: "connection-only",
      capabilities: emptyCapabilities(),
      meters: [],
    },
  };
}

function claudeStatus(): SubscriptionStatus {
  return {
    schemaVersion: 1,
    providerId: "claude",
    connectionState: "connected",
    authMethod: "claude.ai",
    telemetry: {
      state: "unavailable",
      source: "connection-only",
      capabilities: emptyCapabilities(),
      meters: [],
    },
  };
}

function emptyCapabilities() {
  return {
    account: false,
    plan: false,
    rateLimits: false,
    modelTierRateLimits: false,
    contextWindow: false,
    credits: false,
    liveUpdates: false,
  } as const;
}
