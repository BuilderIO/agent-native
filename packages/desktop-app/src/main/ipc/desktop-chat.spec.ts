import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import type { AppConfig } from "@shared/app-registry";
import { net, shell } from "electron";
import { describe, expect, it, vi } from "vitest";

import { readCookieHeaderForUrl } from "../cookie-header";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp"), once: vi.fn() },
  ipcMain: { handle: vi.fn() },
  net: { request: vi.fn() },
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn(async () => {}) },
}));

vi.mock("@agent-native/core/terminal/server", () => ({
  createPtyWebSocketServer: vi.fn(),
}));

vi.mock("../app-store", () => ({
  loadApps: vi.fn(() => []),
}));

vi.mock("../cookie-header", () => ({
  readCookieHeaderForUrl: vi.fn(async () => ""),
}));

import {
  activateDesktopBuilderAccount,
  desktopTerminalMcpArgs,
  desktopTerminalInfo,
  desktopTerminalWorkspacePath,
  DesktopTerminalMcpRelay,
  desktopTerminalOpenCodeEnvironment,
  closeDesktopChatRelay,
  getDesktopBuilderGatewayRunnerEnvironment,
  getDesktopAppMcpAuthorization,
  openDesktopBuilderConnect,
  registerDesktopChatIpc,
  resolveDesktopTerminalCwd,
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
});
