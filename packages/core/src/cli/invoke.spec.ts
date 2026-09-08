import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeAgentMock = vi.hoisted(() => vi.fn());

vi.mock("../a2a/invoke.js", () => ({
  invokeAgent: invokeAgentMock,
}));

describe("invoke CLI helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeAgentMock.mockResolvedValue({
      target: {
        kind: "discovered",
        id: "mail",
        name: "Mail",
        url: "https://mail.agent-native.test",
      },
      prompt: "hello",
      responseText: "done",
    });
  });

  it("parses target and prompt from positional args", async () => {
    const { parseInvokeArgs } = await import("./invoke.js");

    expect(parseInvokeArgs(["mail", "send", "the", "update"])).toMatchObject({
      target: "mail",
      prompt: "send the update",
      json: false,
      help: false,
      errors: [],
    });
  });

  it("parses flag aliases and execution options", async () => {
    const { parseInvokeArgs } = await import("./invoke.js");

    expect(
      parseInvokeArgs([
        "--agent",
        "https://agent.test",
        "--message=hello",
        "--api-key-env",
        "A2A_TOKEN",
        "--timeout-ms",
        "12000",
        "--poll-interval-ms=500",
        "--sync",
        "--no-hint",
        "--json",
      ]),
    ).toMatchObject({
      target: "https://agent.test",
      prompt: "hello",
      apiKeyEnv: "A2A_TOKEN",
      timeoutMs: 12000,
      pollIntervalMs: 500,
      async: false,
      includeInvocationHint: false,
      json: true,
    });
  });

  it("runs an invocation and prints the text response", async () => {
    const { runInvoke } = await import("./invoke.js");
    const stdout = vi.fn();
    const stderr = vi.fn();

    const code = await runInvoke(["mail", "hello"], {
      stdout,
      stderr,
      env: {
        A2A_TOKEN: "secret-token",
        AGENT_NATIVE_WORKSPACE_APP_ID: "calendar",
        APP_URL: "https://calendar.agent-native.test",
      },
    });

    expect(code).toBe(0);
    expect(invokeAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "mail",
        prompt: "hello",
        selfAppId: "calendar",
        selfUrl: "https://calendar.agent-native.test",
      }),
    );
    expect(stdout).toHaveBeenCalledWith("done");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("reads an API key from the requested environment variable", async () => {
    const { runInvoke } = await import("./invoke.js");

    const code = await runInvoke(["mail", "hello", "--api-key-env", "TOKEN"], {
      stdout: vi.fn(),
      stderr: vi.fn(),
      env: { TOKEN: "token-from-env" },
    });

    expect(code).toBe(0);
    expect(invokeAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "token-from-env",
      }),
    );
  });

  it("prints JSON output when requested", async () => {
    const { runInvoke } = await import("./invoke.js");
    const stdout = vi.fn();

    const code = await runInvoke(["mail", "hello", "--json"], {
      stdout,
      stderr: vi.fn(),
      env: {},
    });

    expect(code).toBe(0);
    const printed = JSON.parse(stdout.mock.calls[0]?.[0]);
    expect(printed).toEqual({
      target: {
        kind: "discovered",
        id: "mail",
        name: "Mail",
        url: "https://mail.agent-native.test",
      },
      responseText: "done",
    });
  });

  it("returns an error when the requested API key env var is absent", async () => {
    const { runInvoke } = await import("./invoke.js");
    const stderr = vi.fn();

    const code = await runInvoke(["mail", "hello", "--api-key-env", "TOKEN"], {
      stdout: vi.fn(),
      stderr,
      env: {},
    });

    expect(code).toBe(1);
    expect(stderr).toHaveBeenCalledWith("Env var TOKEN is not set");
    expect(invokeAgentMock).not.toHaveBeenCalled();
  });

  it("shows usage for missing required args", async () => {
    const { runInvoke } = await import("./invoke.js");
    const stderr = vi.fn();

    const code = await runInvoke([], {
      stdout: vi.fn(),
      stderr,
      env: {},
    });

    expect(code).toBe(1);
    expect(stderr.mock.calls.map((call) => call[0]).join("\n")).toContain(
      "Missing <app-or-url>",
    );
    expect(stderr.mock.calls.map((call) => call[0]).join("\n")).toContain(
      'Usage: agent-native invoke <app-or-url> "prompt"',
    );
  });
});
