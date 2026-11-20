import { EventEmitter } from "node:events";
import nodeFs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import { readMirroredMemory } from "@agent-native/core/resources/shared-memory";
import type { AppConfig } from "@shared/app-registry";
import { app, net, shell } from "electron";
import { describe, expect, it, vi } from "vitest";

import { readCookieHeaderForUrl } from "../cookie-header";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp"), once: vi.fn() },
  ipcMain: { handle: vi.fn() },
  net: { request: vi.fn() },
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn(async () => {}) },
}));

vi.mock("@agent-native/core/terminal/pty-server", () => ({
  createPtyWebSocketServer: vi.fn(),
}));

vi.mock("@agent-native/core/resources/shared-memory", async (importActual) => {
  const actual =
    await importActual<
      typeof import("@agent-native/core/resources/shared-memory")
    >();
  return { ...actual, readMirroredMemory: vi.fn(actual.readMirroredMemory) };
});

vi.mock("../app-store", () => ({
  loadApps: vi.fn(() => []),
}));

vi.mock("../cookie-header", () => ({
  readCookieHeaderForUrl: vi.fn(async () => ""),
}));

import {
  activateDesktopBuilderAccount,
  desktopTerminalMcpArgs,
  desktopTerminalMemoryEnvironment,
  desktopTerminalInfo,
  desktopTerminalWorkspacePath,
  DesktopTerminalMcpRelay,
  desktopTerminalOpenCodeEnvironment,
  bindDesktopSessionMemoryOwner,
  closeDesktopChatRelay,
  noteDesktopBuilderRelayOwner,
  setDesktopMemoryAccount,
  PI_TERMINAL_EXTENSION_SOURCE,
  getDesktopBuilderGatewayRunnerEnvironment,
  getDesktopBuilderConnectionStatus,
  getDesktopAppMcpAuthorization,
  openDesktopBuilderConnect,
  registerDesktopChatIpc,
  resolveDesktopTerminalCwd,
  rotateDesktopBuilderRelayBearer,
  resolveTargetUrl,
  shouldForwardRequestHeader,
  shouldForwardResponseHeader,
  stripCodexMcpConfig,
} from "./desktop-chat.js";

describe("desktop chat relay target URLs", () => {
  it("uses selected app folders and a stable app-owned fallback", () => {
    const selectedPath = mkdtempSync(path.join("/tmp", "selected-app-"));
    vi.spyOn(process, "cwd").mockReturnValue(selectedPath);
    vi.stubEnv("AGENT_NATIVE_PROJECT_ROOT", "/");
    vi.stubEnv("CODE_AGENTS_PROJECT_ROOT", "/");
    vi.stubEnv("INIT_CWD", "/");
    vi.stubEnv("PWD", "/");

    try {
      expect(resolveDesktopTerminalCwd(selectedPath)).toBe(selectedPath);
      expect(desktopTerminalWorkspacePath()).toBe("/tmp/terminal-workspace");
      expect(resolveDesktopTerminalCwd()).toBe("/tmp/terminal-workspace");
    } finally {
      rmSync(selectedPath, { recursive: true, force: true });
    }
  });

  it("preserves an explicit project root before the app-owned fallback", () => {
    const projectRoot = mkdtempSync(path.join("/tmp", "project-root-"));
    vi.spyOn(process, "cwd").mockReturnValue("/tmp");
    vi.stubEnv("AGENT_NATIVE_PROJECT_ROOT", projectRoot);
    vi.stubEnv("CODE_AGENTS_PROJECT_ROOT", "/");
    vi.stubEnv("INIT_CWD", "/");
    vi.stubEnv("PWD", "/");

    try {
      expect(resolveDesktopTerminalCwd()).toBe(projectRoot);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("configures the desktop sidebar tool for supported CLI agents", () => {
    const registration = {
      url: "http://127.0.0.1:3456/mcp",
      bearerToken: "a".repeat(43),
    };

    expect(
      desktopTerminalMcpArgs(
        "claude",
        registration,
        "/tmp/desktop config.json",
      ),
    ).toEqual(["--mcp-config", "/tmp/desktop config.json"]);
    expect(
      desktopTerminalMcpArgs("codex", registration, "/tmp/unused.json"),
    ).toEqual([
      "-c",
      'mcp_servers.agent-native-desktop.url="http://127.0.0.1:3456/mcp"',
      "-c",
      `mcp_servers.agent-native-desktop.http_headers={"Authorization"="Bearer ${registration.bearerToken}"}`,
    ]);
    const builderArgs = desktopTerminalMcpArgs(
      "builder",
      registration,
      "/tmp/unused.json",
    );
    expect(builderArgs[0]).toBe("code");
    expect(builderArgs[1]).toBe("--configJson");
    expect(JSON.parse(builderArgs[2])).toEqual({
      isLocal: true,
      mcpServers: {
        "agent-native-desktop": {
          type: "http",
          url: registration.url,
          headers: { Authorization: `Bearer ${registration.bearerToken}` },
        },
      },
    });

    const appRegistration = {
      url: "http://127.0.0.1:4567/mcp",
      bearerToken: "b".repeat(43),
    };
    const codexArgs = desktopTerminalMcpArgs(
      "codex",
      registration,
      "/tmp/unused.json",
      {
        desktop_app_mail: {
          type: "http",
          url: appRegistration.url,
          headers: { Authorization: `Bearer ${appRegistration.bearerToken}` },
        },
      },
    );
    expect(codexArgs).toContain(
      `mcp_servers.desktop_app_mail.url="${appRegistration.url}"`,
    );
    expect(codexArgs.join(" ")).not.toContain("upstream");

    const openCodeEnvironment = desktopTerminalOpenCodeEnvironment({
      "agent-native-desktop": {
        type: "http",
        url: registration.url,
        headers: { Authorization: `Bearer ${registration.bearerToken}` },
      },
      desktop_app_mail: {
        type: "http",
        url: appRegistration.url,
        headers: { Authorization: `Bearer ${appRegistration.bearerToken}` },
      },
    });
    expect(JSON.parse(openCodeEnvironment.OPENCODE_CONFIG_CONTENT)).toEqual({
      mcp: {
        "agent-native-desktop": {
          type: "remote",
          url: registration.url,
          enabled: true,
          oauth: false,
          headers: { Authorization: `Bearer ${registration.bearerToken}` },
        },
        desktop_app_mail: {
          type: "remote",
          url: appRegistration.url,
          enabled: true,
          oauth: false,
          headers: { Authorization: `Bearer ${appRegistration.bearerToken}` },
        },
      },
    });
  });

  it("bounds optional app MCP authorization requests", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ token: "token" }), { status: 200 }),
      );
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(new AbortController().signal);

    try {
      await expect(
        getDesktopAppMcpAuthorization(
          { id: "mail", name: "Mail" } as AppConfig,
          "https://mail.agent-native.com",
        ),
      ).resolves.toEqual({ Authorization: "Bearer token" });
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://mail.agent-native.com/mcp/connect/token",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      timeoutSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("keeps Codex preferences while removing unrelated MCP startup work", () => {
    expect(
      stripCodexMcpConfig(
        [
          'model = "gpt-6-luna"',
          "",
          '[mcp_servers."stale-app"]',
          'url = "https://stale.example/mcp"',
          "",
          "[features]",
          "shell_snapshot = true",
        ].join("\n"),
      ),
    ).toBe('model = "gpt-6-luna"\n\n[features]\nshell_snapshot = true');
  });

  it("returns an authenticated desktop-owned terminal endpoint", () => {
    expect(desktopTerminalInfo(4567, "a token")).toEqual({
      available: true,
      wsUrl: "ws://127.0.0.1:4567/ws?token=a%20token",
    });
    expect(
      desktopTerminalInfo(4567, "token", {
        appId: "mail",
        path: "/inbox",
        view: "inbox",
      }),
    ).toEqual({
      available: true,
      wsUrl:
        "ws://127.0.0.1:4567/ws?token=token&appId=mail&path=%2Finbox&view=inbox",
    });
  });

  it("relays MCP through a loopback bearer without exposing upstream auth", async () => {
    let resolveReceived!: (value: {
      body: string;
      headers: Record<string, string | string[] | undefined>;
    }) => void;
    const received = new Promise<{
      body: string;
      headers: Record<string, string | string[] | undefined>;
    }>((resolve) => {
      resolveReceived = resolve;
    });
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        resolveReceived({
          body: Buffer.concat(chunks).toString(),
          headers: { ...request.headers },
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"jsonrpc":"2.0","id":1,"result":{}}');
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("no port");

    const relay = new DesktopTerminalMcpRelay(
      `http://127.0.0.1:${address.port}/mcp`,
      { Authorization: "Bearer upstream-secret" },
    );
    try {
      const registration = await relay.start();
      const unauthorized = await fetch(registration.url, { method: "POST" });
      expect(unauthorized.status).toBe(401);

      const response = await fetch(registration.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${registration.bearerToken}`,
          "content-type": "application/json",
        },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {},
      });

      const request = await received;
      expect(request.body).toContain('"method":"tools/list"');
      expect(request.headers.authorization).toBe("Bearer upstream-secret");
      expect(request.headers.cookie).toBeUndefined();
    } finally {
      await relay.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("aborts an active streamed MCP response when the relay closes", async () => {
    let resolveRequestClosed!: () => void;
    const requestClosed = new Promise<void>((resolve) => {
      resolveRequestClosed = resolve;
    });
    const upstream = createServer((request, response) => {
      request.once("close", resolveRequestClosed);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"jsonrpc":"2.0","id":1}\n\n');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("no port");

    const relay = new DesktopTerminalMcpRelay(
      `http://127.0.0.1:${address.port}/mcp`,
      {},
    );
    try {
      const registration = await relay.start();
      const response = await fetch(registration.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${registration.bearerToken}`,
          "content-type": "application/json",
        },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      });
      expect(response.status).toBe(200);
      await relay.close();
      await expect(requestClosed).resolves.toBeUndefined();
    } finally {
      await relay.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("rejects dot-segment traversal after URL normalization", () => {
    expect(
      resolveTargetUrl(
        "https://mail.example.com",
        "/_agent-native/../settings",
      ),
    ).toBeNull();
    expect(
      resolveTargetUrl(
        "https://mail.example.com",
        "/_agent-native/%2e%2e/settings",
      ),
    ).toBeNull();
  });

  it("keeps allowed agent-native routes on the app origin", () => {
    expect(
      resolveTargetUrl(
        "https://mail.example.com/app",
        "/_agent-native/agent-chat?surface=desktop",
      )?.toString(),
    ).toBe(
      "https://mail.example.com/app/_agent-native/agent-chat?surface=desktop",
    );
  });

  it("does not forward Electron-restricted browser headers", () => {
    expect(shouldForwardRequestHeader("content-length", "42")).toBe(false);
    expect(shouldForwardRequestHeader("cookie2", "legacy")).toBe(false);
    expect(shouldForwardRequestHeader("transfer-encoding", "chunked")).toBe(
      false,
    );
    expect(
      shouldForwardRequestHeader("x-agent-native-surface", "desktop"),
    ).toBe(true);
    expect(
      shouldForwardRequestHeader(
        "x-internal",
        "secret",
        new Set(["connection", "x-internal"]),
      ),
    ).toBe(false);
  });

  it("drops stale compression and length headers from proxied responses", () => {
    expect(shouldForwardResponseHeader("content-encoding", "gzip")).toBe(false);
    expect(shouldForwardResponseHeader("content-length", "123")).toBe(false);
    expect(shouldForwardResponseHeader("transfer-encoding", "chunked")).toBe(
      false,
    );
    expect(shouldForwardResponseHeader("cache-control", "no-store")).toBe(true);
  });
});

describe("managed Builder Desktop relay", () => {
  it("authenticates the loopback path and streams Dispatch SSE without Builder credentials", async () => {
    const originalFetch = globalThis.fetch;
    const targetHeaders = new Map<string, string>();
    let targetUrl = "";
    let requestBody = "";
    let failBuilderStatus = false;
    let provisionRequest: { url: string; init?: RequestInit } | undefined;
    const upstreamRequest = new EventEmitter() as EventEmitter & {
      abort: ReturnType<typeof vi.fn>;
      chunkedEncoding?: boolean;
      end: ReturnType<typeof vi.fn>;
      setHeader: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
    };
    upstreamRequest.abort = vi.fn();
    upstreamRequest.setHeader = vi.fn((name: string, value: string) => {
      targetHeaders.set(name.toLowerCase(), value);
    });
    upstreamRequest.write = vi.fn((chunk: Buffer | string) => {
      requestBody += chunk.toString();
      return true;
    });
    upstreamRequest.end = vi.fn(() => {
      const upstreamResponse = new EventEmitter() as EventEmitter & {
        headers: Record<string, string>;
        statusCode: number;
      };
      upstreamResponse.headers = {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      };
      upstreamResponse.statusCode = 206;
      upstreamRequest.emit("response", upstreamResponse);
      queueMicrotask(() => {
        upstreamResponse.emit(
          "data",
          Buffer.from('event: message\ndata: {"type":"message_stop"}\n\n'),
        );
        upstreamResponse.emit("end");
      });
    });
    (net.request as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (options: { url: string }) => {
        targetUrl = options.url;
        return upstreamRequest;
      },
    );
    vi.mocked(readCookieHeaderForUrl).mockResolvedValue(
      "session=desktop-session",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl = String(input);
        if (requestUrl.includes("/_agent-native/builder/provision")) {
          provisionRequest = { url: requestUrl, init };
          return new Response(JSON.stringify({ ok: true, scope: "org" }), {
            status: 200,
          });
        }
        if (requestUrl.includes("/_agent-native/connection-status/builder")) {
          if (failBuilderStatus) throw new TypeError("fetch failed");
          return new Response(
            JSON.stringify({
              configured: true,
              builderEnabled: true,
              connectUrl:
                "https://dispatch.example.test/_agent-native/builder/connect?_an_connect=connect-token",
              appHost: "dispatch.example.test",
              apiHost: "dispatch.example.test",
              publicKeyConfigured: true,
              privateKeyConfigured: true,
              credentialSource: "org",
            }),
            { status: 200 },
          );
        }
        if (requestUrl.endsWith("/_agent-native/auth/session")) {
          return new Response(JSON.stringify({ email: "a@example.com" }), {
            status: 200,
          });
        }
        return originalFetch(input, init);
      }),
    );
    registerDesktopChatIpc({
      resolveBuilderDispatchApp: () =>
        ({
          id: "dispatch",
          origin: "https://dispatch.example.test",
          identityAuthority: true,
          session: {} as never,
        }) as never,
    });

    try {
      failBuilderStatus = true;
      await expect(getDesktopBuilderConnectionStatus()).resolves.toEqual({
        state: "unavailable",
        error: "Could not check Builder.io connection status.",
      });
      failBuilderStatus = false;

      const environment = await getDesktopBuilderGatewayRunnerEnvironment();
      expect(environment.status.state).toBe("connected");
      expect(environment.env?.BUILDER_PUBLIC_KEY).toBe("desktop-relay");
      const relayUrl = environment.env?.BUILDER_GATEWAY_BASE_URL;
      const relaySecret = environment.env?.BUILDER_PRIVATE_KEY;
      expect(relayUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(relaySecret).toBeTruthy();

      const opened = await openDesktopBuilderConnect({
        connectAttemptId: "attempt-123456789012",
        scope: "org",
        source: "desktop_code_agents",
        flow: "code_provider_setup",
      });
      expect(opened).toEqual({ ok: true });
      const openedUrl = new URL(
        vi.mocked(shell.openExternal).mock.calls[0]?.[0] ?? "",
      );
      expect(openedUrl.origin).toBe("https://dispatch.example.test");
      expect(openedUrl.pathname).toBe("/_agent-native/builder/connect");
      expect(openedUrl.searchParams.get("_an_connect_attempt")).toBe(
        "attempt-123456789012",
      );
      expect(openedUrl.searchParams.get("scope")).toBe("org");

      const activation = await activateDesktopBuilderAccount({
        provisioningToken: "server-provisioning-token",
        connectToken: "server-connect-token",
        scope: "org",
      });
      expect(activation).toEqual({ ok: true, scope: "org" });
      expect(provisionRequest?.url).toBe(
        "https://dispatch.example.test/_agent-native/builder/provision?signupSource=agent-native",
      );
      expect(provisionRequest?.init?.headers).toMatchObject({
        Cookie: "session=desktop-session",
        Origin: "https://dispatch.example.test",
      });
      expect(String(provisionRequest?.init?.body)).toContain(
        "server-provisioning-token",
      );
      expect(String(provisionRequest?.init?.body)).not.toContain(
        "BUILDER_PRIVATE_KEY",
      );

      const base = relayUrl!;
      const denied = await originalFetch(
        `${base}/messages?apiKey=desktop-relay`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(denied.status).toBe(401);

      const wrongPath = await originalFetch(
        `${base}/other?apiKey=desktop-relay`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${relaySecret}` },
          body: "{}",
        },
      );
      expect(wrongPath.status).toBe(404);

      const badQuery = await originalFetch(
        `${base}/messages?apiKey=not-the-relay`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${relaySecret}` },
          body: "{}",
        },
      );
      expect(badQuery.status).toBe(400);

      const streamBody = '{"model":"builder-model","messages":[]}';
      const response = await originalFetch(
        `${base}/messages?apiKey=desktop-relay`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${relaySecret}`,
            "x-builder-api-key": "must-not-forward",
            "content-type": "application/json",
          },
          body: streamBody,
        },
      );
      expect(response.status).toBe(206);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      await expect(response.text()).resolves.toBe(
        'event: message\ndata: {"type":"message_stop"}\n\n',
      );
      expect(targetUrl).toBe(
        "https://dispatch.example.test/_agent-native/builder/desktop/messages",
      );
      expect(requestBody).toBe(streamBody);
      expect(targetHeaders.get("cookie")).toBe("session=desktop-session");
      expect(targetHeaders.get("authorization")).toBeUndefined();
      expect(targetHeaders.get("x-builder-api-key")).toBeUndefined();
      expect(targetHeaders.get("origin")).toBe("https://dispatch.example.test");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      await closeDesktopChatRelay();
    }
  });
  it("refuses a runner's next request after the relay bearer rotates", async () => {
    const originalFetch = globalThis.fetch;
    const upstreamRequests: string[] = [];
    (net.request as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (options: { url: string }) => {
        upstreamRequests.push(options.url);
        const upstreamRequest = new EventEmitter() as EventEmitter & {
          abort: () => void;
          end: () => void;
          setHeader: () => void;
          write: () => boolean;
        };
        upstreamRequest.abort = () => {};
        upstreamRequest.setHeader = () => {};
        upstreamRequest.write = () => true;
        upstreamRequest.end = () => {
          const upstreamResponse = new EventEmitter() as EventEmitter & {
            headers: Record<string, string>;
            statusCode: number;
          };
          upstreamResponse.headers = { "content-type": "application/json" };
          upstreamResponse.statusCode = 200;
          upstreamRequest.emit("response", upstreamResponse);
          queueMicrotask(() => upstreamResponse.emit("end"));
        };
        return upstreamRequest;
      },
    );
    vi.mocked(readCookieHeaderForUrl).mockResolvedValue("session=owner-a");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/_agent-native/connection-status/builder")
        ) {
          return new Response(
            JSON.stringify({
              configured: true,
              builderEnabled: true,
              connectUrl:
                "https://dispatch.example.test/_agent-native/builder/connect?_an_connect=connect-token",
              appHost: "dispatch.example.test",
              apiHost: "dispatch.example.test",
              publicKeyConfigured: true,
              privateKeyConfigured: true,
              credentialSource: "org",
            }),
            { status: 200 },
          );
        }
        if (String(input).endsWith("/_agent-native/auth/session")) {
          return new Response(JSON.stringify({ email: "a@example.com" }), {
            status: 200,
          });
        }
        return originalFetch(input, init);
      }),
    );
    registerDesktopChatIpc({
      resolveBuilderDispatchApp: () =>
        ({
          id: "dispatch",
          origin: "https://dispatch.example.test",
          identityAuthority: true,
          session: {} as never,
        }) as never,
    });
    const send = (runner: {
      url: string | undefined;
      secret: string | undefined;
    }) =>
      originalFetch(`${runner.url}/messages?apiKey=desktop-relay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runner.secret}`,
          "content-type": "application/json",
        },
        body: '{"messages":[]}',
      });

    try {
      const owner = await getDesktopBuilderGatewayRunnerEnvironment();
      const ownerRunner = {
        url: owner.env?.BUILDER_GATEWAY_BASE_URL,
        secret: owner.env?.BUILDER_PRIVATE_KEY,
      };

      const sameOwner = await send(ownerRunner);
      expect(sameOwner.status).toBe(200);
      expect(upstreamRequests).toHaveLength(1);

      rotateDesktopBuilderRelayBearer();
      const cookieReadsBefore = vi.mocked(readCookieHeaderForUrl).mock.calls
        .length;
      const refused = await send(ownerRunner);
      expect(refused.status).toBe(404);
      expect(upstreamRequests).toHaveLength(1);
      expect(vi.mocked(readCookieHeaderForUrl).mock.calls.length).toBe(
        cookieReadsBefore,
      );

      const next = await getDesktopBuilderGatewayRunnerEnvironment();
      const nextRunner = {
        url: next.env?.BUILDER_GATEWAY_BASE_URL,
        secret: next.env?.BUILDER_PRIVATE_KEY,
      };
      expect(nextRunner.secret).not.toBe(ownerRunner.secret);
      expect((await send(nextRunner)).status).toBe(200);
      expect(upstreamRequests).toHaveLength(2);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      await closeDesktopChatRelay();
    }
  });
});

describe("Builder relay owner handling", () => {
  const connectedStatus = JSON.stringify({
    configured: true,
    builderEnabled: true,
    connectUrl:
      "https://dispatch.example.test/_agent-native/builder/connect?_an_connect=connect-token",
    appHost: "dispatch.example.test",
    apiHost: "dispatch.example.test",
    publicKeyConfigured: true,
    privateKeyConfigured: true,
    credentialSource: "org",
  });

  function deferred() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  // A fresh module per scenario, so the last-seen account starts empty.
  async function harness() {
    vi.resetModules();
    const chat = await import("./desktop-chat.js");
    const { net: freshNet } = await import("electron");
    const { readCookieHeaderForUrl: freshCookieRead } =
      await import("../cookie-header");
    const originalFetch = globalThis.fetch;
    const upstreamRequests: string[] = [];
    vi.mocked(freshNet.request).mockImplementation(((options: {
      url: string;
    }) => {
      upstreamRequests.push(options.url);
      const upstreamRequest = new EventEmitter() as EventEmitter & {
        abort: () => void;
        end: () => void;
        setHeader: () => void;
        write: () => boolean;
      };
      upstreamRequest.abort = () => {};
      upstreamRequest.setHeader = () => {};
      upstreamRequest.write = () => true;
      upstreamRequest.end = () => {
        const upstreamResponse = new EventEmitter() as EventEmitter & {
          headers: Record<string, string>;
          statusCode: number;
        };
        upstreamResponse.headers = { "content-type": "application/json" };
        upstreamResponse.statusCode = 200;
        upstreamRequest.emit("response", upstreamResponse);
        queueMicrotask(() => upstreamResponse.emit("end"));
      };
      return upstreamRequest;
    }) as never);

    const gates: {
      status: ReturnType<typeof deferred> | null;
      cookie: ReturnType<typeof deferred> | null;
    } = { status: null, cookie: null };
    // The Dispatch session as the relay sees it: the cookie header on disk and
    // the account Dispatch reports for each header ("unreadable" is a 503).
    const dispatch = {
      cookie: "session=owner-a",
      accounts: new Map<string, string>([["session=owner-a", "a@example.com"]]),
    };
    vi.mocked(freshCookieRead).mockImplementation(async () => {
      await gates.cookie?.promise;
      return dispatch.cookie;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/_agent-native/connection-status/builder")
        ) {
          await gates.status?.promise;
          return new Response(connectedStatus, { status: 200 });
        }
        if (String(input).endsWith("/_agent-native/auth/session")) {
          const header = new Headers(init?.headers).get("cookie") ?? "";
          const account = dispatch.accounts.get(header);
          if (account === "unreadable")
            return new Response("", { status: 503 });
          return account
            ? new Response(JSON.stringify({ email: account }), { status: 200 })
            : new Response("{}", { status: 200 });
        }
        return originalFetch(input, init);
      }),
    );
    chat.registerDesktopChatIpc({
      resolveBuilderDispatchApp: () =>
        ({
          id: "dispatch",
          origin: "https://dispatch.example.test",
          identityAuthority: true,
          session: {} as never,
        }) as never,
    });
    const send = (runner: {
      url: string | undefined;
      secret: string | undefined;
    }) =>
      originalFetch(`${runner.url}/messages?apiKey=desktop-relay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runner.secret}`,
          "content-type": "application/json",
        },
        body: '{"messages":[]}',
      });
    const runner = async () => {
      const environment =
        await chat.getDesktopBuilderGatewayRunnerEnvironment();
      return {
        url: environment.env?.BUILDER_GATEWAY_BASE_URL,
        secret: environment.env?.BUILDER_PRIVATE_KEY,
      };
    };
    return {
      chat,
      gates,
      dispatch,
      send,
      runner,
      upstreamRequests,
      cookieRead: freshCookieRead,
      cleanup: async () => {
        vi.stubGlobal("fetch", originalFetch);
        await chat.closeDesktopChatRelay();
      },
    };
  }

  it("keeps a runner's bearer from no-account to an account", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("no-account");
      const runner = await h.runner();
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      expect((await h.send(runner)).status).toBe(200);
    } finally {
      await h.cleanup();
    }
  });

  it("keeps a runner's bearer when shared sign-in turns off", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const runner = await h.runner();
      h.chat.noteDesktopBuilderRelayOwner("no-account");
      expect((await h.send(runner)).status).toBe(200);
      h.chat.noteDesktopBuilderRelayOwner(null);
      expect((await h.send(runner)).status).toBe(200);
    } finally {
      await h.cleanup();
    }
  });

  it("keeps a runner's bearer when the same account returns after no-account", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const runner = await h.runner();
      h.chat.noteDesktopBuilderRelayOwner("no-account");
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      expect((await h.send(runner)).status).toBe(200);
    } finally {
      await h.cleanup();
    }
  });

  it("rotates the bearer when a different account follows no-account", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const runner = await h.runner();
      h.chat.noteDesktopBuilderRelayOwner("no-account");
      expect((await h.send(runner)).status).toBe(200);

      h.chat.noteDesktopBuilderRelayOwner("account:b@example.com");
      expect((await h.send(runner)).status).toBe(404);
      expect(h.upstreamRequests).toHaveLength(1);

      const next = await h.runner();
      expect(next.secret).not.toBe(runner.secret);
      expect((await h.send(next)).status).toBe(200);
    } finally {
      await h.cleanup();
    }
  });

  it("rotates the bearer when one account replaces another directly", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const runner = await h.runner();
      h.chat.noteDesktopBuilderRelayOwner("account:b@example.com");
      expect((await h.send(runner)).status).toBe(404);
    } finally {
      await h.cleanup();
    }
  });

  async function setupDuring(
    h: Awaited<ReturnType<typeof harness>>,
    during: () => void,
  ) {
    h.gates.status = deferred();
    const setup = h.chat.getDesktopBuilderGatewayRunnerEnvironment();
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    during();
    h.gates.status.release();
    return setup;
  }

  it("refuses runner setup when a real account replaces another during setup", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const result = await setupDuring(h, () =>
        h.chat.noteDesktopBuilderRelayOwner("account:b@example.com"),
      );
      expect(result.env).toBeUndefined();
      expect(result.error).toMatch(/account changed/i);
    } finally {
      await h.cleanup();
    }
  });

  it("starts a runner when no-account becomes an account during setup", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("no-account");
      const result = await setupDuring(h, () =>
        h.chat.noteDesktopBuilderRelayOwner("account:a@example.com"),
      );
      expect(result.error).toBeUndefined();
      expect(result.env?.BUILDER_PRIVATE_KEY).toBeTruthy();
    } finally {
      await h.cleanup();
    }
  });

  it("starts a runner when the owner key goes null during setup", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const result = await setupDuring(h, () =>
        h.chat.noteDesktopBuilderRelayOwner(null),
      );
      expect(result.error).toBeUndefined();
      expect(result.env?.BUILDER_PRIVATE_KEY).toBeTruthy();
    } finally {
      await h.cleanup();
    }
  });

  it("hands out a bearer when the owner holds through setup", async () => {
    const h = await harness();
    try {
      h.gates.status = deferred();
      const setup = h.chat.getDesktopBuilderGatewayRunnerEnvironment();
      await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
      h.gates.status.release();

      const result = await setup;
      expect(result.error).toBeUndefined();
      expect(result.env?.BUILDER_PRIVATE_KEY).toBeTruthy();
    } finally {
      await h.cleanup();
    }
  });

  it("refuses an admitted request when rotation lands during the cookie read", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const runner = await h.runner();
      h.gates.cookie = deferred();
      const readsBefore = vi.mocked(h.cookieRead).mock.calls.length;
      const pending = h.send(runner);
      await vi.waitFor(() =>
        expect(vi.mocked(h.cookieRead).mock.calls.length).toBeGreaterThan(
          readsBefore,
        ),
      );
      h.chat.noteDesktopBuilderRelayOwner("account:b@example.com");
      h.gates.cookie.release();

      expect((await pending).status).toBe(404);
      expect(h.upstreamRequests).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  it("forwards an admitted request when no rotation lands during the cookie read", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const runner = await h.runner();
      h.gates.cookie = deferred();
      const readsBefore = vi.mocked(h.cookieRead).mock.calls.length;
      const pending = h.send(runner);
      await vi.waitFor(() =>
        expect(vi.mocked(h.cookieRead).mock.calls.length).toBeGreaterThan(
          readsBefore,
        ),
      );
      h.gates.cookie.release();

      expect((await pending).status).toBe(200);
      expect(h.upstreamRequests).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });
  type Harness = Awaited<ReturnType<typeof harness>>;
  function signInAs(h: Harness, cookie: string, email: string) {
    h.dispatch.accounts.set(cookie, email);
    h.dispatch.cookie = cookie;
  }

  it("keeps a runner started before startup verification notes the same session", async () => {
    const h = await harness();
    try {
      const runner = await h.runner();
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      expect((await h.send(runner)).status).toBe(200);
      expect(h.upstreamRequests).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });

  it("keeps a runner when A signs out and back in as A", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const runner = await h.runner();
      h.chat.noteDesktopBuilderRelayOwner("no-account");
      h.dispatch.cookie = "";
      expect((await h.send(runner)).status).toBe(401);
      signInAs(h, "session=owner-a-again", "A@Example.com");
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      expect((await h.send(runner)).status).toBe(200);
      expect(h.upstreamRequests).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });

  it("refuses A's runner once B's cookies are written, before B's owner note", async () => {
    const h = await harness();
    try {
      h.chat.noteDesktopBuilderRelayOwner("account:a@example.com");
      const runner = await h.runner();
      h.chat.noteDesktopBuilderRelayOwner("no-account");
      signInAs(h, "session=owner-b", "b@example.com");
      expect((await h.send(runner)).status).toBe(404);
      expect(h.upstreamRequests).toHaveLength(0);

      h.chat.noteDesktopBuilderRelayOwner("account:b@example.com");
      expect((await h.send(runner)).status).toBe(404);
      expect(h.upstreamRequests).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  it("refuses A's runner when A was never noted and B signs in", async () => {
    const h = await harness();
    try {
      const runner = await h.runner();
      signInAs(h, "session=owner-b", "b@example.com");
      h.chat.noteDesktopBuilderRelayOwner("account:b@example.com");
      expect((await h.send(runner)).status).toBe(404);
      expect(h.upstreamRequests).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  it("refuses a request paused in the cookie read while the session changes", async () => {
    const h = await harness();
    try {
      const runner = await h.runner();
      h.gates.cookie = deferred();
      const readsBefore = vi.mocked(h.cookieRead).mock.calls.length;
      const pending = h.send(runner);
      await vi.waitFor(() =>
        expect(vi.mocked(h.cookieRead).mock.calls.length).toBeGreaterThan(
          readsBefore,
        ),
      );
      signInAs(h, "session=owner-b", "b@example.com");
      h.gates.cookie.release();

      expect((await pending).status).toBe(404);
      expect(h.upstreamRequests).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  it("refuses runner setup paused in the status request while the session changes", async () => {
    const h = await harness();
    try {
      const result = await setupDuring(h, () =>
        signInAs(h, "session=owner-b", "b@example.com"),
      );
      expect(result.env).toBeUndefined();
      expect(result.error).toMatch(/account changed/i);
    } finally {
      await h.cleanup();
    }
  });

  it("starts a runner when the same account re-signs in during setup", async () => {
    const h = await harness();
    try {
      const result = await setupDuring(h, () =>
        signInAs(h, "session=owner-a-again", "a@example.com"),
      );
      expect(result.error).toBeUndefined();
      expect(result.env?.BUILDER_PRIVATE_KEY).toBeTruthy();
    } finally {
      await h.cleanup();
    }
  });

  it("rotates the bearer for a runner started under a different session than the last", async () => {
    const h = await harness();
    try {
      const first = await h.runner();
      signInAs(h, "session=owner-b", "b@example.com");
      const second = await h.runner();
      expect(second.secret).not.toBe(first.secret);
      expect((await h.send(first)).status).toBe(404);
      expect((await h.send(second)).status).toBe(200);
      expect(h.upstreamRequests).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });

  it("refuses with a distinct error when the account cannot be read at request time", async () => {
    const h = await harness();
    try {
      const runner = await h.runner();
      h.dispatch.accounts.set("session=owner-a-later", "unreadable");
      h.dispatch.cookie = "session=owner-a-later";
      expect((await h.send(runner)).status).toBe(503);
      expect(h.upstreamRequests).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  it("hands out no bearer when the account lookup fails at setup, and a later setup works", async () => {
    const h = await harness();
    try {
      const runner = await h.runner();
      const message = /could not confirm your builder\.io account/i;

      h.dispatch.accounts.set("session=owner-a-b", "unreadable");
      h.dispatch.cookie = "session=owner-a-b";
      const unreadable =
        await h.chat.getDesktopBuilderGatewayRunnerEnvironment();
      expect(unreadable.env).toBeUndefined();
      expect(unreadable.error).toMatch(message);

      h.dispatch.accounts.delete("session=owner-a-b");
      const signedOut =
        await h.chat.getDesktopBuilderGatewayRunnerEnvironment();
      expect(signedOut.env).toBeUndefined();
      expect(signedOut.error).toMatch(message);

      // The earlier runner keeps its bearer and its binding to A.
      h.dispatch.accounts.set("session=owner-a-b", "a@example.com");
      expect((await h.send(runner)).status).toBe(200);

      const next = await h.runner();
      expect(next.secret).toBe(runner.secret);
      h.dispatch.accounts.set("session=owner-a-c", "a@example.com");
      h.dispatch.cookie = "session=owner-a-c";
      expect((await h.send(next)).status).toBe(200);
      expect(h.upstreamRequests).toHaveLength(2);
    } finally {
      await h.cleanup();
    }
  });

  it("keeps a runner through ordinary A-to-A cookie refreshes", async () => {
    const h = await harness();
    try {
      const runner = await h.runner();
      for (const cookie of ["session=owner-a-b", "session=owner-a-c"]) {
        signInAs(h, cookie, "a@example.com");
        expect((await h.send(runner)).status).toBe(200);
      }
      const lookups = () =>
        vi
          .mocked(fetch)
          .mock.calls.filter(([url]) =>
            String(url).endsWith("/_agent-native/auth/session"),
          ).length;
      const before = lookups();
      expect((await h.send(runner)).status).toBe(200);
      expect(lookups()).toBe(before);
      expect(h.upstreamRequests).toHaveLength(3);
    } finally {
      await h.cleanup();
    }
  });
});

describe("desktop Pi extension memory prompt", () => {
  async function startSession(promptFile: string) {
    const file = path.join(
      mkdtempSync(path.join("/tmp", "pi-ext-")),
      "ext.mjs",
    );
    writeFileSync(file, PI_TERMINAL_EXTENSION_SOURCE);
    vi.stubEnv("AGENT_NATIVE_TERMINAL_MCP_SERVERS", "{}");
    type Handler = (event: unknown) => { systemPrompt: string };
    const handlers = new Map<string, Handler>();
    const pi = new Proxy(
      { on: (name: string, fn: Handler) => handlers.set(name, fn) },
      { get: (target, key) => (key === "on" ? target.on : () => undefined) },
    );
    const mod = await import(/* @vite-ignore */ file + "?t=" + Math.random());
    mod.default(pi);
    const handler = handlers.get("before_agent_start");
    return () => {
      vi.stubEnv("AGENT_NATIVE_MEMORY_PROMPT_FILE", promptFile);
      return handler ? handler({ systemPrompt: "" }).systemPrompt : "";
    };
  }

  function seedAccounts() {
    const dir = mkdtempSync(path.join("/tmp", "pi-memory-"));
    vi.mocked(app.getPath).mockReturnValue(dir);
    const accounts: Array<{ owner: string; text: string }> = [
      { owner: "a@example.test", text: "ALICE-SECRET" },
      { owner: "b@example.test", text: "BOB-SECRET" },
    ];
    for (const { owner, text } of accounts) {
      const ownerDir = path.join(dir, "memory", encodeURIComponent(owner));
      mkdirSync(ownerDir, { recursive: true });
      writeFileSync(path.join(ownerDir, "MEMORY.md"), text);
    }
    return dir;
  }

  it("loads only the signed-in account's memory", async () => {
    const dir = seedAccounts();
    setDesktopMemoryAccount("a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const prompt = (await startSession(session.file))();
    expect(prompt).toContain("ALICE-SECRET");
    expect(prompt).not.toContain("BOB-SECRET");
    session.release();
    setDesktopMemoryAccount(null);
    const none = await bindDesktopSessionMemoryOwner();
    expect((await startSession(none.file))()).not.toContain("SECRET");
    none.release();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stops a running session's memory when the account switches", async () => {
    seedAccounts();
    setDesktopMemoryAccount("a@example.test");
    const old = await bindDesktopSessionMemoryOwner();
    const oldPrompt = await startSession(old.file);
    expect(oldPrompt()).toContain("ALICE-SECRET");

    setDesktopMemoryAccount("b@example.test");
    const fresh = await bindDesktopSessionMemoryOwner();
    const freshPrompt = await startSession(fresh.file);

    expect(oldPrompt()).not.toContain("SECRET");
    expect(freshPrompt()).toContain("BOB-SECRET");
    expect(freshPrompt()).not.toContain("ALICE-SECRET");
    old.release();
    fresh.release();
    setDesktopMemoryAccount(null);
  });

  it("clears memory for running and new sessions on sign-out", async () => {
    seedAccounts();
    setDesktopMemoryAccount("a@example.test");
    const running = await bindDesktopSessionMemoryOwner();
    const runningPrompt = await startSession(running.file);
    expect(runningPrompt()).toContain("ALICE-SECRET");

    noteDesktopBuilderRelayOwner("no-account");
    const fresh = await bindDesktopSessionMemoryOwner();
    const freshPrompt = await startSession(fresh.file);

    expect(runningPrompt()).not.toContain("SECRET");
    expect(freshPrompt()).not.toContain("SECRET");
    running.release();
    fresh.release();
  });

  it("fails closed when the identity is signed in but unreadable", async () => {
    seedAccounts();
    setDesktopMemoryAccount("a@example.test");
    const running = await bindDesktopSessionMemoryOwner();
    const runningPrompt = await startSession(running.file);
    expect(runningPrompt()).toContain("ALICE-SECRET");

    noteDesktopBuilderRelayOwner(null);
    const fresh = await bindDesktopSessionMemoryOwner();
    const freshPrompt = await startSession(fresh.file);

    expect(runningPrompt()).not.toContain("SECRET");
    expect(freshPrompt()).not.toContain("SECRET");
    running.release();
    fresh.release();
  });

  it("binds memory to a verified account and re-renders sessions started before sign-in", async () => {
    seedAccounts();
    noteDesktopBuilderRelayOwner("no-account");
    const early = await bindDesktopSessionMemoryOwner();
    const earlyPrompt = await startSession(early.file);
    expect(earlyPrompt()).not.toContain("SECRET");

    noteDesktopBuilderRelayOwner("account:a@example.test");
    await vi.waitFor(() => expect(earlyPrompt()).toContain("ALICE-SECRET"));
    const fresh = await bindDesktopSessionMemoryOwner();
    const freshPrompt = await startSession(fresh.file);
    expect(freshPrompt()).toContain("ALICE-SECRET");
    expect(freshPrompt()).not.toContain("BOB-SECRET");

    noteDesktopBuilderRelayOwner("account:b@example.test");
    expect(earlyPrompt()).not.toContain("SECRET");
    expect(freshPrompt()).not.toContain("SECRET");
    early.release();
    fresh.release();
    setDesktopMemoryAccount(null);
  });

  it("reloads memory for existing sessions when the same account signs back in", async () => {
    seedAccounts();
    noteDesktopBuilderRelayOwner("account:a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const prompt = await startSession(session.file);
    expect(prompt()).toContain("ALICE-SECRET");

    noteDesktopBuilderRelayOwner("no-account");
    expect(prompt()).not.toContain("SECRET");
    noteDesktopBuilderRelayOwner("account:a@example.test");
    await vi.waitFor(() => expect(prompt()).toContain("ALICE-SECRET"));
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("removes memory prompt files left by a previous run at startup", async () => {
    const dir = seedAccounts();
    const ownersDir = path.join(dir, "memory-owners");
    mkdirSync(ownersDir, { recursive: true });
    const stale = path.join(ownersDir, "stale-uuid");
    writeFileSync(stale, "ALICE-SECRET");
    vi.resetModules();
    const fresh = await import("./desktop-chat.js");
    fresh.registerDesktopChatIpc();
    expect(existsSync(stale)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("clears a running session's prompt when the tombstone state is unreadable", async () => {
    const dir = seedAccounts();
    const index = path.join(
      dir,
      "memory",
      encodeURIComponent("a@example.test"),
      "MEMORY.md",
    );
    setDesktopMemoryAccount("a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const prompt = await startSession(session.file);
    expect(prompt()).toContain("ALICE-SECRET");

    writeFileSync(`${index}.deleted`, "not-a-number");
    await vi.waitFor(() => expect(prompt()).not.toContain("ALICE"));
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("refreshes a running session's memory when the file changes", async () => {
    const dir = seedAccounts();
    const index = path.join(
      dir,
      "memory",
      encodeURIComponent("a@example.test"),
      "MEMORY.md",
    );
    setDesktopMemoryAccount("a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const prompt = await startSession(session.file);
    expect(prompt()).toContain("ALICE-SECRET");

    writeFileSync(index, "ALICE-UPDATED");
    await vi.waitFor(() => expect(prompt()).toContain("ALICE-UPDATED"));
    expect(prompt()).not.toContain("ALICE-SECRET");

    writeFileSync(`${index}.deleted`, String(Date.now() + 60_000));
    await vi.waitFor(() => expect(prompt()).not.toContain("ALICE"));
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("gives terminals a memory directory holding only the signed-in account's own", async () => {
    const dir = seedAccounts();
    setDesktopMemoryAccount("a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const env = desktopTerminalMemoryEnvironment(
      session.file,
      session.memoryDir,
    );
    const root = env.AGENT_NATIVE_MEMORY_DIR as string;
    expect(root).toBeTruthy();
    expect(readdirSync(root)).toEqual([encodeURIComponent("a@example.test")]);
    expect(
      realpathSync(path.join(root, encodeURIComponent("a@example.test"))),
    ).toBe(
      realpathSync(
        path.join(dir, "memory", encodeURIComponent("a@example.test")),
      ),
    );
    writeFileSync(
      path.join(root, encodeURIComponent("a@example.test"), "saved.md"),
      "from terminal",
    );
    expect(
      readFileSync(
        path.join(
          dir,
          "memory",
          encodeURIComponent("a@example.test"),
          "saved.md",
        ),
        "utf8",
      ),
    ).toBe("from terminal");
    session.release();
    expect(existsSync(root)).toBe(false);
    setDesktopMemoryAccount(null);
  });

  it("revokes a running terminal's memory root on sign-out and relinks the next account", async () => {
    seedAccounts();
    noteDesktopBuilderRelayOwner("account:a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const root = session.memoryDir as string;
    expect(readdirSync(root)).toEqual([encodeURIComponent("a@example.test")]);

    noteDesktopBuilderRelayOwner("no-account");
    expect(readdirSync(root)).toEqual([]);

    noteDesktopBuilderRelayOwner("account:a@example.test");
    expect(readdirSync(root)).toEqual([encodeURIComponent("a@example.test")]);
    noteDesktopBuilderRelayOwner("account:b@example.test");
    expect(readdirSync(root)).toEqual([encodeURIComponent("b@example.test")]);
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("keeps terminal access when the account email changes only in case", async () => {
    seedAccounts();
    noteDesktopBuilderRelayOwner("account:a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const root = session.memoryDir as string;

    setDesktopMemoryAccount(" A@Example.test ");
    expect(readdirSync(root)).toEqual([encodeURIComponent("a@example.test")]);
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("links a running terminal to the next account after a sign-out", async () => {
    seedAccounts();
    setDesktopMemoryAccount("a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const root = session.memoryDir as string;
    expect(readdirSync(root)).toEqual([encodeURIComponent("a@example.test")]);

    setDesktopMemoryAccount(null);
    expect(readdirSync(root)).toEqual([]);

    setDesktopMemoryAccount("b@example.test");
    expect(readdirSync(root)).toEqual([encodeURIComponent("b@example.test")]);
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("never lets an inherited memory directory reach a terminal without its own root", () => {
    const previous = process.env.AGENT_NATIVE_MEMORY_DIR;
    process.env.AGENT_NATIVE_MEMORY_DIR = "/parent/broad/memory";
    try {
      const merged = {
        ...process.env,
        ...desktopTerminalMemoryEnvironment("/tmp/prompt.md", undefined),
      };
      expect(merged.AGENT_NATIVE_MEMORY_DIR).toBe("");
    } finally {
      if (previous === undefined) delete process.env.AGENT_NATIVE_MEMORY_DIR;
      else process.env.AGENT_NATIVE_MEMORY_DIR = previous;
    }
  });

  it("gives a session started before sign-in access once an account binds", async () => {
    seedAccounts();
    noteDesktopBuilderRelayOwner("no-account");
    const session = await bindDesktopSessionMemoryOwner();
    const root = session.memoryDir as string;
    expect(root).toBeTruthy();
    expect(readdirSync(root)).toEqual([]);

    noteDesktopBuilderRelayOwner("account:a@example.test");
    expect(readdirSync(root)).toEqual([encodeURIComponent("a@example.test")]);
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("starts the session with an empty root when the link cannot be created", async () => {
    seedAccounts();
    const link = vi.spyOn(nodeFs, "symlinkSync").mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      noteDesktopBuilderRelayOwner("account:a@example.test");
      const session = await bindDesktopSessionMemoryOwner();
      expect(readdirSync(session.memoryDir as string)).toEqual([]);
      session.release();
    } finally {
      link.mockRestore();
      log.mockRestore();
      setDesktopMemoryAccount(null);
    }
  });

  it("serializes refreshes so a slow stale read cannot restore deleted memory", async () => {
    const dir = seedAccounts();
    const index = path.join(
      dir,
      "memory",
      encodeURIComponent("a@example.test"),
      "MEMORY.md",
    );
    setDesktopMemoryAccount("a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const prompt = await startSession(session.file);
    expect(prompt()).toContain("ALICE-SECRET");

    const actual = await vi.importActual<
      typeof import("@agent-native/core/resources/shared-memory")
    >("@agent-native/core/resources/shared-memory");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let slowStarted = false;
    vi.mocked(readMirroredMemory).mockImplementationOnce(async (...args) => {
      slowStarted = true;
      const result = await actual.readMirroredMemory(...args);
      await gate;
      return result;
    });
    writeFileSync(index, "ALICE-STALE");
    await vi.waitFor(() => expect(slowStarted).toBe(true));
    writeFileSync(`${index}.deleted`, String(Date.now() + 60_000));
    // fixed-sleep-ok: the watcher event has no completion signal to await
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();

    await vi.waitFor(() => expect(prompt()).not.toContain("ALICE"));
    // fixed-sleep-ok: proving a stale write never arrives needs a quiet period
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(prompt()).not.toContain("ALICE");
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("sees a memory change made while the initial read is still running", async () => {
    const dir = seedAccounts();
    const index = path.join(
      dir,
      "memory",
      encodeURIComponent("a@example.test"),
      "MEMORY.md",
    );
    setDesktopMemoryAccount("a@example.test");
    const actual = await vi.importActual<
      typeof import("@agent-native/core/resources/shared-memory")
    >("@agent-native/core/resources/shared-memory");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let slowStarted = false;
    vi.mocked(readMirroredMemory).mockImplementationOnce(async (...args) => {
      const result = await actual.readMirroredMemory(...args);
      slowStarted = true;
      await gate;
      return result;
    });
    const binding = bindDesktopSessionMemoryOwner();
    await vi.waitFor(() => expect(slowStarted).toBe(true));
    writeFileSync(index, "ALICE-LATE");
    // fixed-sleep-ok: the watcher event has no completion signal to await
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    const session = await binding;
    const prompt = await startSession(session.file);

    await vi.waitFor(() => expect(prompt()).toContain("ALICE-LATE"));
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("keeps the last good prompt when a memory read fails", async () => {
    const dir = seedAccounts();
    const index = path.join(
      dir,
      "memory",
      encodeURIComponent("a@example.test"),
      "MEMORY.md",
    );
    setDesktopMemoryAccount("a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    const prompt = await startSession(session.file);
    expect(prompt()).toContain("ALICE-SECRET");

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const actual = await vi.importActual<
      typeof import("@agent-native/core/resources/shared-memory")
    >("@agent-native/core/resources/shared-memory");
    vi.mocked(readMirroredMemory).mockRejectedValue(new Error("EIO"));
    writeFileSync(index, "ALICE-NEXT");
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(prompt()).toContain("ALICE-SECRET");
    vi.mocked(readMirroredMemory).mockImplementation(actual.readMirroredMemory);
    logged.mockRestore();

    writeFileSync(index, "ALICE-RECOVERED");
    await vi.waitFor(() => expect(prompt()).toContain("ALICE-RECOVERED"));
    session.release();
    setDesktopMemoryAccount(null);
  });

  it("injects nothing for a memory whose tombstone is newer than its file", async () => {
    const dir = seedAccounts();
    const index = path.join(
      dir,
      "memory",
      encodeURIComponent("a@example.test"),
      "MEMORY.md",
    );
    writeFileSync(`${index}.deleted`, String(Date.now() + 60_000));
    setDesktopMemoryAccount("a@example.test");
    const session = await bindDesktopSessionMemoryOwner();
    expect((await startSession(session.file))()).not.toContain("SECRET");
    session.release();
    setDesktopMemoryAccount(null);
  });
});
