import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (app: any) => app,
  markDefaultPluginProvided: vi.fn(),
}));

const close = vi.fn();
const createPtyWebSocketServer = vi.fn(async () => ({
  server: {} as any,
  port: 4567,
  close,
}));

vi.mock("./pty-server.js", () => ({
  createPtyWebSocketServer,
}));

function createNitroApp() {
  const mounted: Array<{ path: string; handler: any }> = [];
  return {
    mounted,
    use: vi.fn((path: string, handler: any) => {
      mounted.push({ path, handler });
    }),
  };
}

function route(app: ReturnType<typeof createNitroApp>, path: string) {
  const mounted = app.mounted.find((entry) => entry.path === path);
  if (!mounted) throw new Error(`Route not mounted: ${path}`);
  return mounted.handler;
}

describe("createTerminalPlugin", () => {
  const envKeys = [
    "NODE_ENV",
    "AGENT_TERMINAL_ENABLED",
    "AGENT_TERMINAL_PORT",
    "AGENT_CLI_COMMAND",
    "FRAME_PORT",
    "__AGENT_TERMINAL_RUNNING",
  ] as const;
  const originalEnv = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalEnv.clear();
    createPtyWebSocketServer.mockClear();
    close.mockClear();
  });

  function rememberEnv() {
    for (const key of envKeys) originalEnv.set(key, process.env[key]);
  }

  it("always mounts available CLIs without requiring the PTY server", async () => {
    rememberEnv();
    process.env.NODE_ENV = "production";
    process.env.AGENT_TERMINAL_ENABLED = "false";
    const { createTerminalPlugin } = await import("./terminal-plugin.js");
    const app = createNitroApp();

    await createTerminalPlugin()(app);

    const result = await route(app, "/_agent-native/available-clis")({});
    expect(result.map((entry: any) => entry.command)).toEqual(
      expect.arrayContaining(["builder", "claude", "codex"]),
    );
    expect(createPtyWebSocketServer).not.toHaveBeenCalled();
  });

  it("does not start a production terminal without an authCheck", async () => {
    rememberEnv();
    process.env.NODE_ENV = "production";
    process.env.AGENT_TERMINAL_ENABLED = "true";
    const { createTerminalPlugin } = await import("./terminal-plugin.js");
    const app = createNitroApp();

    await createTerminalPlugin()(app);

    expect(await route(app, "/_agent-native/agent-terminal-info")({})).toEqual({
      available: false,
      error: "Terminal requires authCheck in production",
    });
    expect(createPtyWebSocketServer).not.toHaveBeenCalled();
  });

  it("passes the production authCheck through to the PTY server", async () => {
    rememberEnv();
    process.env.NODE_ENV = "production";
    process.env.AGENT_TERMINAL_ENABLED = "true";
    const authCheck = vi.fn(() => true);
    const { createTerminalPlugin } = await import("./terminal-plugin.js");
    const app = createNitroApp();

    await createTerminalPlugin({ authCheck, command: "codex" })(app);

    expect(createPtyWebSocketServer).toHaveBeenCalledWith(
      expect.objectContaining({
        authCheck,
        command: "codex",
      }),
    );
    expect(await route(app, "/_agent-native/agent-terminal-info")({})).toEqual({
      available: true,
      wsPort: 4567,
      command: "codex",
    });
  });
});
