import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

const spawnSync = vi.fn(() => ({ status: 0 }));
const execSync = vi.fn(() => "");

vi.mock("node:child_process", () => ({
  spawnSync,
  execSync,
}));

interface FakePty {
  pid: number;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  emitData: (data: string) => void;
  emitExit: (exitCode: number) => void;
}

const ptys: FakePty[] = [];
const spawn = vi.fn(() => {
  const pty: FakePty = {
    pid: 999_999 + ptys.length,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => {
      pty.emitData = handler;
    }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      pty.emitExit = (exitCode: number) => handler({ exitCode });
    }),
    emitData: () => {},
    emitExit: () => {},
  };
  ptys.push(pty);
  return pty;
});

vi.mock("node-pty", () => ({ spawn }));

function unexpectedStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("unexpected-response", (_request, response) => {
      resolve(response.statusCode ?? 0);
    });
    ws.on("open", () => {
      ws.close();
      reject(new Error("WebSocket unexpectedly opened"));
    });
    ws.on("error", reject);
  });
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once("message", (data) =>
      resolve(typeof data === "string" ? data : data.toString()),
    );
  });
}

function openSocketAndMessage(
  url: string,
): Promise<{ ws: WebSocket; message: string }> {
  return new Promise((resolve, reject) => {
    let opened = false;
    let firstMessage: string | null = null;
    const ws = new WebSocket(url);

    const maybeResolve = () => {
      if (opened && firstMessage !== null) {
        resolve({ ws, message: firstMessage });
      }
    };

    ws.once("open", () => {
      opened = true;
      maybeResolve();
    });
    ws.once("message", (data) => {
      firstMessage = typeof data === "string" ? data : data.toString();
      maybeResolve();
    });
    ws.once("error", reject);
  });
}

describe("createPtyWebSocketServer", () => {
  let servers: Array<{ close: () => void }> = [];
  let tempDirs: string[] = [];

  beforeEach(() => {
    spawn.mockClear();
    spawnSync.mockClear();
    execSync.mockClear();
    ptys.length = 0;
  });

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
    vi.restoreAllMocks();
  });

  async function createServer(
    options: Parameters<
      typeof import("./pty-server.js").createPtyWebSocketServer
    >[0] = {},
  ) {
    const { createPtyWebSocketServer } = await import("./pty-server.js");
    const server = await createPtyWebSocketServer({
      logPrefix: "[test-terminal]",
      ...options,
    });
    servers.push(server);
    return server;
  }

  it("rejects unauthenticated WebSocket upgrades", async () => {
    const server = await createServer({ authCheck: () => false });

    await expect(
      unexpectedStatus(`ws://127.0.0.1:${server.port}/ws`),
    ).resolves.toBe(401);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("resolves packaged node-pty helpers into the unpacked app", async () => {
    const { resolvePtySpawnHelper } = await import("./pty-server.js");

    expect(
      resolvePtySpawnHelper(
        "/Applications/Agent-Native.app/Contents/Resources/app.asar/node_modules/node-pty/package.json",
      ),
    ).toBe(
      `/Applications/Agent-Native.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`,
    );
  });

  it("wraps Windows command shims with cmd.exe", async () => {
    const { preparePtySpawn } = await import("./pty-server.js");
    const commandPath = String.raw`C:\Users\steve\AppData\Roaming\npm\codex.cmd`;

    expect(preparePtySpawn(commandPath, ["--full-auto"], "win32")).toEqual({
      command: process.env.ComSpec || process.env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", commandPath, "--full-auto"],
    });
    expect(preparePtySpawn(commandPath, [], "darwin")).toEqual({
      command: commandPath,
      args: [],
    });
  });

  it("preserves Windows path backslashes in terminal flags", async () => {
    const { parseTerminalArguments } = await import("./pty-server.js");

    expect(
      parseTerminalArguments(
        String.raw`--add-dir C:\Users\steve\Projects\framework`,
        "win32",
      ),
    ).toEqual(["--add-dir", String.raw`C:\Users\steve\Projects\framework`]);
  });

  it("repairs a non-executable packaged spawn helper", async () => {
    const helperDir = mkdtempSync(path.join(os.tmpdir(), "pty-helper-"));
    tempDirs.push(helperDir);
    const helper = path.join(helperDir, "spawn-helper");
    mkdirSync(path.dirname(helper), { recursive: true });
    writeFileSync(helper, "helper");
    chmodSync(helper, 0o644);

    const { ensurePtySpawnHelperExecutable } = await import("./pty-server.js");
    ensurePtySpawnHelperExecutable(helper);

    expect(statSync(helper).mode & 0o100).toBeTruthy();
  });

  it("only upgrades the terminal WebSocket route", async () => {
    const server = await createServer({ authCheck: () => true });

    await expect(
      unexpectedStatus(`ws://127.0.0.1:${server.port}/not-terminal`),
    ).resolves.toBe(404);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects commands outside the allowlist", async () => {
    const server = await createServer();
    const { ws, message: rawMessage } = await openSocketAndMessage(
      `ws://127.0.0.1:${server.port}/ws?command=sh`,
    );

    const message = JSON.parse(rawMessage);

    expect(message).toMatchObject({
      type: "setup-status",
      status: "not-found",
    });
    expect(message.message).toContain("not a recognized CLI");
    expect(spawn).not.toHaveBeenCalled();
    ws.close();
  });

  it("cleans up each PTY once across exit and WebSocket close", async () => {
    const server = await createServer({ command: "builder" });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);
    await vi.waitFor(() => expect(ptys).toHaveLength(1));

    ptys[0].emitExit(0);
    ws.close();

    await vi.waitFor(() => expect(ptys[0]?.kill).toHaveBeenCalledTimes(1));
  });

  it("does not force-kill a parent PID after natural PTY exit", async () => {
    const processKill = vi.spyOn(process, "kill");
    const server = await createServer({ command: "builder" });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);
    await vi.waitFor(() => expect(ptys).toHaveLength(1));

    ptys[0].emitExit(0);
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(processKill).not.toHaveBeenCalledWith(ptys[0].pid, "SIGKILL");
    ws.close();
  });

  it("cleans up active PTYs when the server closes", async () => {
    const server = await createServer({ command: "builder" });
    await openSocket(`ws://127.0.0.1:${server.port}/ws`);
    await vi.waitFor(() => expect(ptys).toHaveLength(1));

    server.close();

    await vi.waitFor(() => expect(ptys[0]?.kill).toHaveBeenCalledTimes(1));
  });

  it("does not spawn a PTY after shutdown interrupts command setup", async () => {
    let setupStarted!: () => void;
    let releaseSetup!: () => void;
    const setupStartedPromise = new Promise<void>((resolve) => {
      setupStarted = resolve;
    });
    const setupPromise = new Promise<string[]>((resolve) => {
      releaseSetup = () => resolve([]);
    });
    const server = await createServer({
      command: "builder",
      getCommandArgs: async () => {
        setupStarted();
        return setupPromise;
      },
    });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);

    await setupStartedPromise;
    server.close();
    releaseSetup();

    await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not spawn a PTY after the client closes during command setup", async () => {
    let resolveSetupStarted!: () => void;
    let releaseSetup!: () => void;
    const setupStarted = new Promise<void>((resolve) => {
      resolveSetupStarted = resolve;
    });
    const setupRelease = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    const server = await createServer({
      command: "builder",
      getSessionSetup: async () => {
        resolveSetupStarted();
        await setupRelease;
        return {};
      },
    });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);

    await setupStarted;
    ws.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseSetup();

    await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects shell metacharacters in flags before spawning", async () => {
    const server = await createServer();
    const { ws, message: rawMessage } = await openSocketAndMessage(
      `ws://127.0.0.1:${server.port}/ws?command=builder&flags=--help%3Bwhoami`,
    );

    const message = JSON.parse(rawMessage);

    expect(message).toMatchObject({
      type: "setup-status",
      status: "failed",
      message: "Invalid flags: shell metacharacters not allowed",
    });
    expect(spawn).not.toHaveBeenCalled();
    ws.close();
  });

  it("reports PTY spawn failures as terminal setup errors", async () => {
    spawn.mockImplementationOnce(() => {
      throw new Error("posix_spawnp failed");
    });
    const server = await createServer({ command: "builder" });
    const { ws, message: rawMessage } = await openSocketAndMessage(
      `ws://127.0.0.1:${server.port}/ws`,
    );

    expect(JSON.parse(rawMessage)).toEqual({
      type: "setup-status",
      status: "failed",
      message: "Failed to spawn PTY: posix_spawnp failed",
    });
    ws.close();
  });

  it("pipes terminal input and clamps resize messages", async () => {
    const server = await createServer({ command: "builder" });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);
    await vi.waitFor(() => expect(ptys).toHaveLength(1));

    ws.send(JSON.stringify({ type: "resize", cols: 200_000, rows: 0 }));
    ws.send(JSON.stringify({ type: "resize", cols: "nope", rows: 30 }));
    ws.send("hello");
    await vi.waitFor(() =>
      expect(ptys[0]?.write).toHaveBeenCalledWith("hello"),
    );
    await vi.waitFor(() => expect(ptys[0].resize).toHaveBeenCalledTimes(1));

    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        cols: 120,
        rows: 40,
      }),
    );
    expect(ptys[0].resize).toHaveBeenCalledWith(65535, 1);
    ws.close();
  });

  it("shell-quotes trusted host command arguments", async () => {
    const server = await createServer({
      command: "builder",
      getCommandArgs: () => [
        "--mcp-config",
        "/tmp/desktop surface.json",
        "it's-safe",
      ],
    });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);
    await vi.waitFor(() => expect(ptys).toHaveLength(1));

    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      ["--mcp-config", "/tmp/desktop surface.json", "it's-safe"],
      expect.objectContaining({ cwd: expect.any(String) }),
    );
    ws.close();
  });

  it("passes the active app context to each PTY session setup", async () => {
    const onClose = vi.fn();
    const getSessionSetup = vi.fn(() => ({
      commandArgs: ["--from-session-setup"],
      environment: { SESSION_CONTEXT: "mail" },
      onClose,
    }));
    const server = await createServer({
      command: "builder",
      getSessionSetup,
    });
    const ws = await openSocket(
      `ws://127.0.0.1:${server.port}/ws?appId=mail&path=%2Finbox&view=inbox`,
    );
    await vi.waitFor(() => expect(ptys).toHaveLength(1));

    expect(getSessionSetup).toHaveBeenCalledWith("builder", {
      appId: "mail",
      path: "/inbox",
      view: "inbox",
    });
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      ["--from-session-setup"],
      expect.objectContaining({
        env: expect.objectContaining({ SESSION_CONTEXT: "mail" }),
      }),
    );

    ws.close();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("does not write env vars sent through the terminal bridge to .env", async () => {
    const appDir = mkdtempSync(path.join(os.tmpdir(), "agent-terminal-"));
    tempDirs.push(appDir);
    const server = await createServer({ appDir, command: "builder" });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);

    ws.send(
      JSON.stringify({
        type: "agentNative.setEnvVars",
        data: {
          vars: [
            { key: "GOOD_KEY", value: 'hello "world"' },
            { key: "MULTILINE", value: "alpha\nbeta" },
            { key: "BAD-KEY", value: "ignored" },
          ],
        },
      }),
    );

    const message = JSON.parse(await nextMessage(ws));

    expect(message).toEqual({
      type: "env-vars-saved",
      keys: ["GOOD_KEY", "MULTILINE"],
      storage: "scoped-secrets",
    });
    expect(existsSync(path.join(appDir, ".env"))).toBe(false);
    ws.close();
  });
});
