import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  it("pipes terminal input and clamps resize messages", async () => {
    const server = await createServer({ command: "builder" });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);
    await vi.waitFor(() => expect(ptys).toHaveLength(1));

    ws.send(JSON.stringify({ type: "resize", cols: 200_000, rows: 0 }));
    ws.send(JSON.stringify({ type: "resize", cols: "nope", rows: 30 }));
    ws.send("hello");
    await vi.waitFor(() => expect(ptys[0]?.write).toHaveBeenCalledWith("hello"));
    await vi.waitFor(() => expect(ptys[0].resize).toHaveBeenCalledTimes(1));

    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      ["-l", "-c", "builder"],
      expect.objectContaining({
        cols: 120,
        rows: 40,
      }),
    );
    expect(ptys[0].resize).toHaveBeenCalledWith(65535, 1);
    ws.close();
  });

  it("sanitizes env var writes sent through the terminal bridge", async () => {
    const appDir = mkdtempSync(path.join(os.tmpdir(), "agent-terminal-"));
    tempDirs.push(appDir);
    const server = await createServer({ appDir, command: "builder" });
    const ws = await openSocket(`ws://127.0.0.1:${server.port}/ws`);

    ws.send(
      JSON.stringify({
        type: "builder.setEnvVars",
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
    const envFile = readFileSync(path.join(appDir, ".env"), "utf-8");

    expect(message).toEqual({
      type: "env-vars-saved",
      keys: ["GOOD_KEY", "MULTILINE"],
    });
    expect(envFile).toContain('GOOD_KEY="hello \\"world\\""');
    expect(envFile).toContain("MULTILINE=alphabeta");
    expect(envFile).not.toContain("BAD-KEY");
    ws.close();
  });
});
