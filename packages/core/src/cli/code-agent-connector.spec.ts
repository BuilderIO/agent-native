import { execFile as execFileCallback } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return { ...actual, spawn: spawnMock };
});

import { runCodeAgentConnector } from "./code-agent-connector.js";
import {
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
} from "./code-agent-runs.js";

const execFile = promisify(execFileCallback);
const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  delete process.env.AGENT_NATIVE_REMOTE_DEVICE_PATH;
  for (const root of tempRoots.splice(0)) {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

describe("runCodeAgentConnector", () => {
  it("creates a Portal run without reading its id before initialization", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "code-agent-connector-test-"),
    );
    tempRoots.push(root);
    const source = path.join(root, "source");
    const remote = path.join(root, "remote.git");
    const store = path.join(root, "code-agents");
    const configPath = path.join(root, "remote-device.json");
    await fs.promises.mkdir(source, { recursive: true });
    await execFile("git", ["init", "--bare", remote]);
    await execFile("git", ["init", source]);
    await execFile("git", ["config", "user.name", "Portal Test"], {
      cwd: source,
    });
    await execFile("git", ["config", "user.email", "portal@example.test"], {
      cwd: source,
    });
    await fs.promises.writeFile(path.join(source, "tracked.txt"), "test\n");
    await execFile("git", ["add", "tracked.txt"], { cwd: source });
    await execFile("git", ["commit", "-m", "initial"], { cwd: source });
    await execFile("git", ["remote", "add", "origin", remote], {
      cwd: source,
    });
    const commit = String(
      (await execFile("git", ["rev-parse", "HEAD"], { cwd: source })).stdout,
    ).trim();
    await execFile("git", ["push", "origin", `HEAD:refs/heads/portal/test`], {
      cwd: source,
    });
    await fs.promises.mkdir(store, { recursive: true });
    await fs.promises.writeFile(
      configPath,
      JSON.stringify({
        token: "test-token",
        deviceId: "device-test",
        deviceName: "Portal test device",
        relayUrl: "https://relay.test",
        workspacePath: source,
      }),
    );
    process.env.AGENT_NATIVE_CODE_AGENTS_HOME = store;
    process.env.AGENT_NATIVE_REMOTE_DEVICE_PATH = configPath;

    const fakeChild = Object.assign(new EventEmitter(), {
      pid: 12345,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      unref: vi.fn(),
    });
    spawnMock.mockReturnValue(fakeChild);

    const command = {
      id: "remote-command-test",
      kind: "create-run",
      params: {
        prompt: "Read-only Portal test",
        goalId: "task",
        runId: "remote-run-test",
        permissionMode: "read-only",
        metadata: {
          portal: {
            schemaVersion: 1,
            handoffId: "handoff-test",
            branch: "portal/test",
            remoteRef: "refs/heads/portal/test",
            commit,
            sourceBranch: "main",
            sourceDirty: false,
            createdCommit: false,
            repositoryName: "source",
            remoteName: "origin",
            envPolicy: "load-local",
          },
        },
      },
    };
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        const responseBody = requests.length === 1 ? { command } : { ok: true };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(responseBody),
        } as Response;
      }),
    );
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    await runCodeAgentConnector({ output, once: true });

    const run = getCodeAgentRunRecord("remote-run-test");
    expect(run).toMatchObject({
      id: "remote-run-test",
      cwd: expect.stringContaining("/code-agents/portals/"),
      metadata: {
        remote: {
          commandId: "remote-command-test",
          remoteRunId: "remote-run-test",
        },
      },
    });
    expect(listCodeAgentTranscriptEvents("remote-run-test")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "status",
          message: "Remote Agent-Native Code run queued.",
        }),
      ]),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["code", "run", "remote-run-test"]),
      expect.objectContaining({
        cwd: expect.stringContaining("/code-agents/portals/"),
      }),
    );
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/_agent-native/integrations/remote/poll",
      "/_agent-native/integrations/remote/result",
      "/_agent-native/integrations/remote/run-events",
    ]);
  });
});
