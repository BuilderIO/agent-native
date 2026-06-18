import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConnectDeps,
  hostedApps,
  normalizeUrl,
  parseConnectArgs,
  resolveClients,
  runConnect,
  runDeviceFlow,
  supportsRemoteMcpOAuth,
  writeConfigs,
} from "./connect.js";

const tmpRoots: string[] = [];
const originalHome = process.env.HOME;

beforeEach(() => {
  process.exitCode = undefined;
  process.env.HOME = tmpDir();
  // Keep CLI output out of the test log; individual tests that assert on
  // output re-spy with their own captured implementation.
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-connect-"));
  tmpRoots.push(root);
  return root;
}

const noopSleep = () => Promise.resolve();

function fakeJwt(sub: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ sub })}.sig`;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

describe("parseConnectArgs", () => {
  it("parses the positional url and defaults", () => {
    const p = parseConnectArgs(["https://mail.agent-native.com"]);
    expect(p.url).toBe("https://mail.agent-native.com");
    expect(p.client).toBe("all");
    expect(p.clientExplicit).toBe(false);
    expect(p.scope).toBe("user");
    expect(p.all).toBe(false);
    expect(p.token).toBeUndefined();
  });

  it("parses flags in both --flag value and --flag=value forms", () => {
    const p = parseConnectArgs([
      "https://x.com",
      "--client",
      "codex",
      "--scope=user",
      "--name",
      "my-server",
      "--token=abc123",
    ]);
    expect(p.client).toBe("codex");
    expect(p.clientExplicit).toBe(true);
    expect(p.scope).toBe("user");
    expect(p.name).toBe("my-server");
    expect(p.token).toBe("abc123");
  });

  it("parses --all without a url", () => {
    const p = parseConnectArgs(["--all", "--client", "claude-code"]);
    expect(p.all).toBe(true);
    expect(p.url).toBeUndefined();
    expect(p.client).toBe("claude-code");
  });

  it("parses developer profile switches", () => {
    const p = parseConnectArgs([
      "dev",
      "--apps",
      "mail,calendar",
      "--client",
      "codex",
      "--gateway=http://127.0.0.1:8088",
      "--owner-email",
      "u@example.com",
    ]);
    expect(p.mode).toBe("dev");
    expect(p.apps).toBe("mail,calendar");
    expect(p.client).toBe("codex");
    expect(p.gateway).toBe("http://127.0.0.1:8088");
    expect(p.ownerEmail).toBe("u@example.com");
  });

  it("parses reconnect and reauth modes", () => {
    expect(
      parseConnectArgs(["reconnect", "https://plan.agent-native.com"]),
    ).toMatchObject({
      mode: "reconnect",
      url: "https://plan.agent-native.com",
    });
    expect(
      parseConnectArgs(["reauth", "--name", "agent-native-plan"]),
    ).toMatchObject({
      mode: "reauth",
      name: "agent-native-plan",
    });
  });

  it("parses --service-token and --ttl-days", () => {
    const p = parseConnectArgs([
      "https://plan.agent-native.com",
      "--service-token",
      "pr-recap",
      "--ttl-days=90",
    ]);
    expect(p.url).toBe("https://plan.agent-native.com");
    expect(p.serviceToken).toBe("pr-recap");
    expect(p.ttlDays).toBe(90);
    expect(p.token).toBeUndefined();
  });

  it("parses --full-catalog", () => {
    const p = parseConnectArgs([
      "https://plan.agent-native.com",
      "--full-catalog",
      "--client",
      "codex",
    ]);
    expect(p.url).toBe("https://plan.agent-native.com");
    expect(p.fullCatalog).toBe(true);
    expect(p.client).toBe("codex");
  });

  it("defaults fullCatalog to undefined when flag is absent", () => {
    const p = parseConnectArgs(["https://plan.agent-native.com"]);
    expect(p.fullCatalog).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

describe("normalizeUrl", () => {
  it("strips trailing slashes and keeps the origin", () => {
    expect(normalizeUrl("https://mail.agent-native.com/")).toBe(
      "https://mail.agent-native.com",
    );
    expect(normalizeUrl("https://mail.agent-native.com///")).toBe(
      "https://mail.agent-native.com",
    );
    expect(normalizeUrl("  http://localhost:3000  ")).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects empty input", () => {
    expect(() => normalizeUrl("")).toThrow(/Missing app URL/);
  });

  it("rejects non-URLs", () => {
    expect(() => normalizeUrl("mail.agent-native.com")).toThrow(
      /Not a valid URL/,
    );
  });

  it("rejects unsupported schemes", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow(
      /Unsupported URL scheme/,
    );
  });

  it("rejects plaintext HTTP for non-loopback hosts", () => {
    expect(() => normalizeUrl("http://mail.agent-native.com")).toThrow(
      /Refusing plaintext HTTP/,
    );
    expect(normalizeUrl("http://127.0.0.1:3000/app")).toBe(
      "http://127.0.0.1:3000/app",
    );
  });
});

describe("resolveClients", () => {
  it("expands 'all' to every selectable client", () => {
    expect(resolveClients("all")).toEqual([
      "claude-code",
      "codex",
      "cowork",
      "cursor",
      "opencode",
      "github-copilot",
    ]);
  });

  it("returns a single client when named", () => {
    expect(resolveClients("codex")).toEqual(["codex"]);
  });

  it("accepts common GitHub Copilot / VS Code aliases", () => {
    expect(resolveClients("copilot")).toEqual(["github-copilot"]);
    expect(resolveClients("vscode")).toEqual(["github-copilot"]);
    expect(resolveClients("vs-code")).toEqual(["github-copilot"]);
  });

  it("throws on an unknown client", () => {
    expect(() => resolveClients("vim")).toThrow(/Unknown --client/);
  });
});

describe("supportsRemoteMcpOAuth", () => {
  it("treats Claude Code clients as native remote MCP OAuth clients", () => {
    expect(supportsRemoteMcpOAuth("claude-code")).toBe(true);
    expect(supportsRemoteMcpOAuth("claude-code-cli")).toBe(true);
    expect(supportsRemoteMcpOAuth("cursor")).toBe(true);
    expect(supportsRemoteMcpOAuth("opencode")).toBe(true);
    expect(supportsRemoteMcpOAuth("github-copilot")).toBe(true);
    expect(supportsRemoteMcpOAuth("codex")).toBe(false);
    expect(supportsRemoteMcpOAuth("cowork")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Device-flow poll state machine
// ---------------------------------------------------------------------------

function makeFetch(
  pollResponses: any[],
  start: Record<string, unknown> = {},
): typeof fetch {
  let pollIdx = 0;
  return vi.fn(async (url: string) => {
    if (String(url).endsWith("/.well-known/oauth-protected-resource")) {
      return new Response(
        JSON.stringify({
          resource: `${new URL(String(url)).origin}/_agent-native/mcp`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (String(url).endsWith("/device/start")) {
      return new Response(
        JSON.stringify({
          device_code: "dev-123",
          user_code: "WXYZ-1234",
          verification_uri: "https://app.example.com/connect",
          verification_uri_complete:
            "https://app.example.com/connect?code=WXYZ-1234",
          interval: 1,
          expires_in: 600,
          ...start,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const body = pollResponses[Math.min(pollIdx++, pollResponses.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("runDeviceFlow", () => {
  it("polls pending then resolves on approved", async () => {
    const open = vi.fn();
    const deps: ConnectDeps = {
      fetchImpl: makeFetch([
        { status: "pending" },
        { status: "pending" },
        {
          status: "approved",
          token: "tok-abc",
          mcpUrl: "https://app.example.com/_agent-native/mcp",
          serverName: "agent-native-app",
        },
      ]),
      sleep: noopSleep,
      openBrowser: open,
    };
    const grant = await runDeviceFlow(
      "https://app.example.com",
      "app",
      "all",
      deps,
    );
    expect(grant).toEqual({
      token: "tok-abc",
      mcpUrl: "https://app.example.com/_agent-native/mcp",
      serverName: "agent-native-app",
    });
    expect(open).toHaveBeenCalledWith(
      "https://app.example.com/connect?code=WXYZ-1234",
    );
  });

  it("can wrap browser launch with an embedded spinner hook", async () => {
    const open = vi.fn();
    const withBrowserOpenSpinner = vi.fn(async (_message, openBrowser) => {
      await openBrowser();
    });

    const grant = await runDeviceFlow("https://app.example.com", "app", "all", {
      fetchImpl: makeFetch([
        {
          status: "approved",
          token: "tok-abc",
          mcpUrl: "https://app.example.com/_agent-native/mcp",
          serverName: "agent-native-app",
        },
      ]),
      sleep: noopSleep,
      openBrowser: open,
      withBrowserOpenSpinner,
    });

    expect(grant?.token).toBe("tok-abc");
    expect(withBrowserOpenSpinner).toHaveBeenCalledWith(
      "Opening browser for approval",
      expect.any(Function),
    );
    expect(open).toHaveBeenCalledWith(
      "https://app.example.com/connect?code=WXYZ-1234",
    );
  });

  it("accepts an approved local entry without a bearer token", async () => {
    const grant = await runDeviceFlow(
      "http://localhost:4321",
      "analytics",
      "codex",
      {
        fetchImpl: makeFetch([
          {
            status: "approved",
            token: "",
            mcpUrl: "http://localhost:4321/_agent-native/mcp",
            serverName: "agent-native-analytics-local",
            mcpServerEntry: {
              type: "http",
              url: "http://localhost:4321/_agent-native/mcp",
              headers: { "X-Agent-Native-Owner-Email": "u@example.com" },
            },
          },
        ]),
        sleep: noopSleep,
        openBrowser: vi.fn(),
      },
    );
    expect(grant).toEqual({
      token: undefined,
      mcpUrl: "http://localhost:4321/_agent-native/mcp",
      serverName: "agent-native-analytics-local",
      headers: { "X-Agent-Native-Owner-Email": "u@example.com" },
    });
  });

  it("returns null on expired", async () => {
    const grant = await runDeviceFlow("https://app.example.com", "app", "all", {
      fetchImpl: makeFetch([{ status: "pending" }, { status: "expired" }]),
      sleep: noopSleep,
      openBrowser: vi.fn(),
    });
    expect(grant).toBeNull();
  });

  it("returns null on consumed", async () => {
    const grant = await runDeviceFlow("https://app.example.com", "app", "all", {
      fetchImpl: makeFetch([{ status: "consumed" }]),
      sleep: noopSleep,
      openBrowser: vi.fn(),
    });
    expect(grant).toBeNull();
  });

  it("times out when the deadline passes with no approval", async () => {
    let t = 0;
    const grant = await runDeviceFlow("https://app.example.com", "app", "all", {
      fetchImpl: makeFetch([{ status: "pending" }], { expires_in: 2 }),
      sleep: noopSleep,
      openBrowser: vi.fn(),
      // First call (deadline calc) → 0; subsequent loop checks advance past
      // the 2s expiry so the loop exits.
      now: () => (t === 0 ? ((t = 1), 0) : 5000),
    });
    expect(grant).toBeNull();
  });

  it("returns null when the start endpoint is unreachable", async () => {
    const grant = await runDeviceFlow("https://app.example.com", "app", "all", {
      fetchImpl: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      sleep: noopSleep,
      openBrowser: vi.fn(),
    });
    expect(grant).toBeNull();
  });

  it("retries transient server errors while polling, then gives up", async () => {
    // A cold/propagating instance can briefly 5xx (or bare-404) before its
    // route/DB is ready; the connect flow must ride that out rather than fail
    // on the first blip. Persistent failure still gives up gracefully.
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let pollCount = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/device/start")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-123",
            user_code: "WXYZ-1234",
            verification_uri: "https://app.example.com/connect",
            verification_uri_complete:
              "https://app.example.com/connect?code=WXYZ-1234",
            interval: 1,
            expires_in: 600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      pollCount++;
      return new Response(JSON.stringify({ error: "database unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const grant = await runDeviceFlow("https://app.example.com", "app", "all", {
      fetchImpl,
      sleep: noopSleep,
      openBrowser: vi.fn(),
    });

    expect(grant).toBeNull();
    // The transient 503 is retried (not fatal on the first poll), then the
    // flow gives up once the failure streak is exhausted.
    expect(pollCount).toBeGreaterThan(1);
    expect(err.mock.calls.flat().join("")).toContain("not responding");
  });

  it("recovers when a transient poll error is followed by approval", async () => {
    // The core durable-404 guarantee: a bare-404 / 5xx blip mid-poll must not
    // kill the connect — the next healthy poll should still complete.
    let pollCount = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/device/start")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-123",
            user_code: "WXYZ-1234",
            verification_uri: "https://app.example.com/connect",
            verification_uri_complete:
              "https://app.example.com/connect?code=WXYZ-1234",
            interval: 1,
            expires_in: 600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      pollCount++;
      // First two polls hit a cold/propagating instance (bare 404, no JSON
      // body) — the exact recurring "Cannot find any route matching" case.
      if (pollCount <= 2) {
        return new Response("Cannot find any route matching", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          status: "approved",
          token: "tok-after-blip",
          mcpUrl: "https://app.example.com/_agent-native/mcp",
          serverName: "app",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const grant = await runDeviceFlow("https://app.example.com", "app", "all", {
      fetchImpl,
      sleep: noopSleep,
      openBrowser: vi.fn(),
    });

    expect(grant).not.toBeNull();
    expect(grant?.token).toBe("tok-after-blip");
    expect(pollCount).toBe(3);
  });

  it("returns null immediately when polling returns a terminal error body", async () => {
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let pollCount = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/device/start")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-123",
            user_code: "WXYZ-1234",
            verification_uri: "https://app.example.com/connect",
            verification_uri_complete:
              "https://app.example.com/connect?code=WXYZ-1234",
            interval: 1,
            expires_in: 600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      pollCount++;
      return new Response(
        JSON.stringify({ status: "not_found", message: "unknown code" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const grant = await runDeviceFlow("https://app.example.com", "app", "all", {
      fetchImpl,
      sleep: noopSleep,
      openBrowser: vi.fn(),
    });

    expect(grant).toBeNull();
    expect(pollCount).toBe(1);
    expect(err.mock.calls.flat().join("")).toContain("unknown code");
  });
});

// ---------------------------------------------------------------------------
// Idempotent config writing
// ---------------------------------------------------------------------------

describe("writeConfigs", () => {
  it("writes a JSON HTTP entry for claude-code (project scope)", () => {
    const root = tmpDir();
    const written = writeConfigs(
      ["claude-code"],
      "agent-native-mail",
      "https://mail.agent-native.com/_agent-native/mcp",
      "tok-1",
      "project",
      root,
    );
    const file = written[0].file;
    expect(file).toBe(path.join(root, ".mcp.json"));
    const cfg = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "https://mail.agent-native.com/_agent-native/mcp",
      headers: { Authorization: "Bearer tok-1" },
    });
  });

  it("writes a JSON HTTP entry with server-provided headers and no token", () => {
    const root = tmpDir();
    const written = writeConfigs(
      ["claude-code"],
      "agent-native-analytics-local",
      "http://localhost:4321/_agent-native/mcp",
      undefined,
      "project",
      root,
      { "X-Agent-Native-Owner-Email": "u@example.com" },
    );
    const cfg = JSON.parse(fs.readFileSync(written[0].file, "utf-8"));
    expect(cfg.mcpServers["agent-native-analytics-local"]).toEqual({
      type: "http",
      url: "http://localhost:4321/_agent-native/mcp",
      headers: { "X-Agent-Native-Owner-Email": "u@example.com" },
    });
  });

  it("is idempotent: re-running replaces the same entry, no duplicates", () => {
    const root = tmpDir();
    writeConfigs(
      ["claude-code"],
      "agent-native-mail",
      "https://mail.agent-native.com/_agent-native/mcp",
      "tok-1",
      "project",
      root,
    );
    writeConfigs(
      ["claude-code"],
      "agent-native-mail",
      "https://mail.agent-native.com/_agent-native/mcp",
      "tok-2",
      "project",
      root,
    );
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(Object.keys(cfg.mcpServers)).toEqual(["agent-native-mail"]);
    expect(cfg.mcpServers["agent-native-mail"].headers.Authorization).toBe(
      "Bearer tok-2",
    );
  });

  it("preserves unrelated existing JSON entries", () => {
    const root = tmpDir();
    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 2),
    );
    writeConfigs(
      ["claude-code"],
      "agent-native-mail",
      "https://mail.agent-native.com/_agent-native/mcp",
      "tok-1",
      "project",
      root,
    );
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
    expect(cfg.mcpServers["agent-native-mail"].type).toBe("http");
  });

  it("writes a Codex TOML block with HTTP url + auth header", () => {
    const root = tmpDir();
    const HOME = process.env.HOME;
    // Point HOME at our tmp dir so ~/.codex/config.toml lands under it.
    const codexHome = tmpDir();
    process.env.HOME = codexHome;
    try {
      const written = writeConfigs(
        ["codex"],
        "agent-native-mail",
        "https://mail.agent-native.com/_agent-native/mcp",
        "tok-1",
        "project",
        root,
      );
      const f = written[0].file;
      expect(f).toBe(path.join(codexHome, ".codex", "config.toml"));
      const toml = fs.readFileSync(f, "utf-8");
      expect(toml).toContain('[mcp_servers."agent-native-mail"]');
      expect(toml).toContain(
        'url = "https://mail.agent-native.com/_agent-native/mcp"',
      );
      expect(toml).toContain('"Authorization" = "Bearer tok-1"');
      // Re-run is idempotent (single block).
      writeConfigs(
        ["codex"],
        "agent-native-mail",
        "https://mail.agent-native.com/_agent-native/mcp",
        "tok-2",
        "project",
        root,
      );
      const toml2 = fs.readFileSync(f, "utf-8");
      const occurrences =
        toml2.split('[mcp_servers."agent-native-mail"]').length - 1;
      expect(occurrences).toBe(1);
      expect(toml2).toContain("Bearer tok-2");
    } finally {
      process.env.HOME = HOME;
    }
  });

  it("writes Codex TOML headers returned by the server", () => {
    const root = tmpDir();
    const HOME = process.env.HOME;
    const codexHome = tmpDir();
    process.env.HOME = codexHome;
    try {
      const written = writeConfigs(
        ["codex"],
        "agent-native-analytics-local",
        "http://localhost:4321/_agent-native/mcp",
        undefined,
        "project",
        root,
        { "X-Agent-Native-Owner-Email": "u@example.com" },
      );
      const toml = fs.readFileSync(written[0].file, "utf-8");
      expect(toml).toContain('"X-Agent-Native-Owner-Email" = "u@example.com"');
      expect(toml).not.toContain("Authorization");
    } finally {
      process.env.HOME = HOME;
    }
  });

  it("quotes Codex TOML server names with punctuation", () => {
    const root = tmpDir();
    const HOME = process.env.HOME;
    const codexHome = tmpDir();
    process.env.HOME = codexHome;
    try {
      const written = writeConfigs(
        ["codex"],
        'agent.native "mail"',
        "https://mail.agent-native.com/_agent-native/mcp",
        "tok-1",
        "project",
        root,
      );
      const toml = fs.readFileSync(written[0].file, "utf-8");
      expect(toml).toContain('[mcp_servers."agent.native \\"mail\\""]');
    } finally {
      process.env.HOME = HOME;
    }
  });

  it("replaces legacy unquoted Codex TOML blocks for safe names", () => {
    const root = tmpDir();
    const HOME = process.env.HOME;
    const codexHome = tmpDir();
    const codexFile = path.join(codexHome, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(
      codexFile,
      '[mcp_servers.agent-native-mail]\nurl = "https://old.example/mcp"\n',
    );
    process.env.HOME = codexHome;
    try {
      writeConfigs(
        ["codex"],
        "agent-native-mail",
        "https://mail.agent-native.com/_agent-native/mcp",
        "tok-1",
        "project",
        root,
      );
      const toml = fs.readFileSync(codexFile, "utf-8");
      expect(toml).not.toContain("[mcp_servers.agent-native-mail]");
      expect(toml).toContain('[mcp_servers."agent-native-mail"]');
      expect(toml).toContain(
        'url = "https://mail.agent-native.com/_agent-native/mcp"',
      );
    } finally {
      process.env.HOME = HOME;
    }
  });
});

// ---------------------------------------------------------------------------
// hostedApps respects the allow-list
// ---------------------------------------------------------------------------

describe("hostedApps", () => {
  it("returns only visible (non-hidden) templates that have a prodUrl", () => {
    const apps = hostedApps();
    const names = apps.map((a) => a.name);
    // Allow-listed hosted apps are present.
    expect(names).toContain("mail");
    expect(names).toContain("calendar");
    // Hidden templates must never appear.
    expect(names).not.toContain("voice");
    expect(names).not.toContain("scheduling");
    expect(names).not.toContain("macros");
    // Every returned app has an https prodUrl.
    for (const a of apps) {
      expect(a.url).toMatch(/^https:\/\//);
    }
  });
});

// ---------------------------------------------------------------------------
// runConnect end-to-end (token fallback + exit codes)
// ---------------------------------------------------------------------------

describe("runConnect", () => {
  const originalExitCode = process.exitCode;
  const originalCwd = process.cwd();
  const originalPlanPublishPath = process.env.PLAN_PUBLISH_CONFIG_PATH;
  let planPublishPath: string;

  beforeEach(() => {
    // Isolate the canonical publish-token write to a temp file so tests never
    // touch the real ~/.agent-native/plan-publish.json. This is also the env
    // override the local Plans server reads.
    planPublishPath = path.join(tmpDir(), "plan-publish.json");
    process.env.PLAN_PUBLISH_CONFIG_PATH = planPublishPath;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.chdir(originalCwd);
    if (originalPlanPublishPath === undefined) {
      delete process.env.PLAN_PUBLISH_CONFIG_PATH;
    } else {
      process.env.PLAN_PUBLISH_CONFIG_PATH = originalPlanPublishPath;
    }
  });

  it("token fallback skips the device flow and writes the entry", async () => {
    const root = tmpDir();
    process.chdir(root);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runConnect([
      "https://mail.agent-native.com",
      "--client",
      "claude-code",
      "--scope",
      "project",
      "--token",
      "tok-fallback",
    ]);

    expect(process.exitCode).toBeFalsy();
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "https://mail.agent-native.com/_agent-native/mcp",
      headers: {
        Authorization: "Bearer tok-fallback",
      },
    });
  });

  it("uses the canonical 'plan' server name for first-party Plans device-flow connects", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);

    try {
      await runConnect(["https://plan.agent-native.com", "--client", "codex"], {
        fetchImpl: makeFetch([
          {
            status: "approved",
            token: "tok-plan-device",
            mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
            serverName: "agent-native-plan",
          },
        ]),
        sleep: noopSleep,
        openBrowser: vi.fn(),
      });

      expect(process.exitCode).toBeFalsy();
      const toml = fs.readFileSync(
        path.join(home, ".codex", "config.toml"),
        "utf-8",
      );
      expect(toml).toContain('[mcp_servers."plan"]');
      expect(toml).toContain('"Authorization" = "Bearer tok-plan-device"');
      expect(toml).not.toContain('[mcp_servers."agent-native-plan"]');
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("reconnect reauthenticates an existing Codex entry without writing a duplicate", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const codexFile = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(
      codexFile,
      [
        '[mcp_servers."custom-plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer old-token" }',
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      await runConnect(
        ["reconnect", "https://plan.agent-native.com", "--client", "codex"],
        {
          fetchImpl: makeFetch([
            {
              status: "approved",
              token: "new-token",
              mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
              serverName: "agent-native-plan",
            },
          ]),
          sleep: noopSleep,
          openBrowser: vi.fn(),
        },
      );

      expect(process.exitCode).toBeFalsy();
      const toml = fs.readFileSync(codexFile, "utf-8");
      expect(toml).toContain('[mcp_servers."custom-plan"]');
      expect(toml).toContain('"Authorization" = "Bearer new-token"');
      expect(toml).not.toContain("old-token");
      expect(toml).not.toContain('[mcp_servers."agent-native-plan"]');
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("reconnect adds bearer auth to an existing URL-only Codex entry", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const codexFile = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(
      codexFile,
      [
        '[mcp_servers."plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      await runConnect(
        ["reconnect", "https://plan.agent-native.com", "--client", "codex"],
        {
          fetchImpl: makeFetch([
            {
              status: "approved",
              token: "fresh-token",
              mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
              serverName: "plan",
            },
          ]),
          sleep: noopSleep,
          openBrowser: vi.fn(),
        },
      );

      expect(process.exitCode).toBeFalsy();
      const toml = fs.readFileSync(codexFile, "utf-8");
      expect(toml).toContain('[mcp_servers."plan"]');
      expect(toml).toContain('"Authorization" = "Bearer fresh-token"');
      expect(toml).not.toContain("X-Agent-Native-MCP-Full-Catalog");
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("reconnect migrates the legacy first-party Plans server name to canonical 'plan'", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const codexFile = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(
      codexFile,
      [
        '[mcp_servers."agent-native-plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer stale-token" }',
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      await runConnect(
        ["reconnect", "https://plan.agent-native.com", "--client", "codex"],
        {
          fetchImpl: makeFetch([
            {
              status: "approved",
              token: "fresh-token",
              mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
              serverName: "agent-native-plan",
            },
          ]),
          sleep: noopSleep,
          openBrowser: vi.fn(),
        },
      );

      expect(process.exitCode).toBeFalsy();
      const toml = fs.readFileSync(codexFile, "utf-8");
      expect(toml).toContain('[mcp_servers."plan"]');
      expect(toml).toContain('"Authorization" = "Bearer fresh-token"');
      expect(toml).not.toContain('[mcp_servers."agent-native-plan"]');
      expect(toml).not.toContain("stale-token");
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("reconnect with a URL auto-selects the canonical entry and cleans duplicate aliases", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const codexFile = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(
      codexFile,
      [
        '[mcp_servers."agent-native-plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer stale-1" }',
        "",
        '[mcp_servers."plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer stale-2" }',
        "",
        '[mcp_servers."agent-native-plans"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer stale-3" }',
        "",
      ].join("\n"),
      "utf-8",
    );

    const promptClients = vi.fn();
    const outLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      outLines.push(String(chunk));
      return true;
    });

    try {
      await runConnect(["reconnect", "https://plan.agent-native.com"], {
        fetchImpl: makeFetch([
          {
            status: "approved",
            token: "fresh-token",
            mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
            serverName: "agent-native-plan",
          },
        ]),
        sleep: noopSleep,
        openBrowser: vi.fn(),
        isInteractive: () => true,
        promptClients,
      });

      expect(process.exitCode).toBeFalsy();
      expect(promptClients).not.toHaveBeenCalled();
      const toml = fs.readFileSync(codexFile, "utf-8");
      expect(toml).toContain('[mcp_servers."plan"]');
      expect(toml).toContain('"Authorization" = "Bearer fresh-token"');
      expect(toml).not.toContain('[mcp_servers."agent-native-plan"]');
      expect(toml).not.toContain('[mcp_servers."agent-native-plans"]');
      expect(toml).not.toContain("stale-1");
      expect(toml).not.toContain("stale-2");
      expect(toml).not.toContain("stale-3");
      expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
      const combined = outLines.join("");
      expect(combined).toContain("Reconnected Plan MCP");
      expect(combined).toContain(
        "Codex: start a new Codex session now; the MCP tools should be available there.",
      );
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("reconnect reports requested clients that had no matching local entry", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const codexFile = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(
      codexFile,
      [
        '[mcp_servers."plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer stale-token" }',
        "",
      ].join("\n"),
      "utf-8",
    );
    const outLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      outLines.push(String(chunk));
      return true;
    });

    try {
      await runConnect(
        [
          "reconnect",
          "https://plan.agent-native.com",
          "--client",
          "codex,cowork",
        ],
        {
          fetchImpl: makeFetch([
            {
              status: "approved",
              token: "fresh-token",
              mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
              serverName: "plan",
            },
          ]),
          sleep: noopSleep,
          openBrowser: vi.fn(),
        },
      );

      expect(process.exitCode).toBeFalsy();
      const combined = outLines.join("");
      expect(combined).toContain(
        "Reconnected existing client configs for Codex.",
      );
      expect(combined).toContain(
        "Did not touch Claude Cowork because no matching MCP entry was found.",
      );
      expect(combined).toContain(
        "connect https://plan.agent-native.com --client CLIENT --scope user",
      );
      expect(combined).not.toContain("<client>");
      expect(combined).toContain("Reconnected Plan MCP");
      expect(combined).toContain(
        "Codex: start a new Codex session now; the MCP tools should be available there.",
      );
      expect(fs.existsSync(path.join(home, ".cowork", "mcp.json"))).toBe(false);
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("reconnect with a URL fails instead of installing when no existing entry matches", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const fetchImpl = vi.fn();

    try {
      await runConnect(
        ["reconnect", "https://plan.agent-native.com", "--client", "codex"],
        {
          fetchImpl,
          sleep: noopSleep,
          openBrowser: vi.fn(),
        },
      );

      expect(process.exitCode).toBe(1);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(home, ".codex", "config.toml"))).toBe(
        false,
      );
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("reconnect without a URL fails clearly when no existing entry is present", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);

    try {
      await runConnect(["reconnect", "--client", "codex"]);
      expect(process.exitCode).toBe(1);
      expect(fs.existsSync(path.join(home, ".codex", "config.toml"))).toBe(
        false,
      );
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("persists a canonical { url, token } for a first-party Plans app", async () => {
    const root = tmpDir();
    process.chdir(root);

    await runConnect([
      "https://plan.agent-native.com",
      "--client",
      "codex",
      "--scope",
      "project",
      "--token",
      "tok-plan-publish",
    ]);

    expect(process.exitCode).toBeFalsy();
    const canonical = JSON.parse(fs.readFileSync(planPublishPath, "utf-8"));
    // Shape consumed by templates/plan/server/lib/plan-publish.ts.
    expect(canonical).toMatchObject({
      url: "https://plan.agent-native.com",
      token: "tok-plan-publish",
    });
    expect(typeof canonical.updatedAt).toBe("string");
  });

  it("does NOT write plan-publish.json for non-Plans first-party apps (prevents last-write-wins clobber)", async () => {
    const root = tmpDir();
    process.chdir(root);

    // Connecting a non-Plans first-party app (e.g. mail) must NOT overwrite
    // ~/.agent-native/plan-publish.json. If it did, `connect --all` (which
    // iterates apps in arbitrary order) could silently replace the canonical
    // Plans token with the wrong URL+token, breaking publish-visual-plan.
    await runConnect([
      "https://mail.agent-native.com",
      "--client",
      "codex",
      "--scope",
      "project",
      "--token",
      "tok-mail",
    ]);

    expect(fs.existsSync(planPublishPath)).toBe(false);
  });

  it("merges into an existing canonical file without clobbering other keys", async () => {
    const root = tmpDir();
    process.chdir(root);
    fs.mkdirSync(path.dirname(planPublishPath), { recursive: true });
    fs.writeFileSync(
      planPublishPath,
      JSON.stringify({ keepMe: "yes", token: "stale", url: "https://old" }),
    );

    await runConnect([
      "https://plan.agent-native.com",
      "--client",
      "codex",
      "--scope",
      "project",
      "--token",
      "tok-new",
    ]);

    const canonical = JSON.parse(fs.readFileSync(planPublishPath, "utf-8"));
    expect(canonical.keepMe).toBe("yes");
    expect(canonical.url).toBe("https://plan.agent-native.com");
    expect(canonical.token).toBe("tok-new");
  });

  it("does NOT write the canonical token for a non-first-party host", async () => {
    const root = tmpDir();
    process.chdir(root);

    await runConnect([
      "https://my-app.ngrok-free.dev",
      "--client",
      "codex",
      "--scope",
      "project",
      "--token",
      "tok-custom",
    ]);

    expect(fs.existsSync(planPublishPath)).toBe(false);
  });

  it("mints a supplemental publish token for OAuth-only Claude Code connecting to the first-party Plans app", async () => {
    const root = tmpDir();
    process.chdir(root);
    // makeFetch handles OAuth metadata + device/start + device/poll
    const fetchImpl = makeFetch([
      {
        status: "approved",
        token: "tok-publish-mint",
        mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
        serverName: "agent-native-plan",
      },
    ]);

    await runConnect(
      [
        "https://plan.agent-native.com",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ],
      { fetchImpl, sleep: noopSleep, openBrowser: vi.fn() },
    );

    expect(process.exitCode).toBeFalsy();
    // OAuth clients get a supplemental device-flow mint for the publish store.
    const canonical = JSON.parse(fs.readFileSync(planPublishPath, "utf-8"));
    expect(canonical).toMatchObject({
      url: "https://plan.agent-native.com",
      token: "tok-publish-mint",
    });
    // The Claude Code MCP entry itself must NOT have a bearer header.
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers.plan).toEqual({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });
  });

  it("warns gracefully and does not fail connect when the supplemental publish-token mint fails", async () => {
    const root = tmpDir();
    process.chdir(root);
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    // OAuth metadata succeeds; device/start fails (server error).
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/.well-known/oauth-protected-resource")) {
        return new Response(
          JSON.stringify({
            resource: "https://plan.agent-native.com/_agent-native/mcp",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Simulate a device/start failure.
      return new Response(JSON.stringify({ error: "unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await runConnect(
      [
        "https://plan.agent-native.com",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ],
      { fetchImpl, sleep: noopSleep, openBrowser: vi.fn() },
    );

    // Connect must succeed even if the supplemental mint failed.
    expect(process.exitCode).toBeFalsy();
    // No canonical publish file written since the mint returned no token.
    expect(fs.existsSync(planPublishPath)).toBe(false);
    // A warning should be visible.
    expect(output.join("")).toContain("could not mint a publish token");
  });

  it("writes OAuth-native Claude Code entries after validating metadata", async () => {
    const root = tmpDir();
    process.chdir(root);
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://mail.agent-native.com/.well-known/oauth-protected-resource",
      );
      expect(init?.method).toBe("GET");
      return new Response(
        JSON.stringify({
          resource: "https://mail.agent-native.com/_agent-native/mcp",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const openBrowser = vi.fn();

    await runConnect(
      [
        "https://mail.agent-native.com",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ],
      { fetchImpl, openBrowser },
    );

    expect(process.exitCode).toBeFalsy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(openBrowser).not.toHaveBeenCalled();
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "https://mail.agent-native.com/_agent-native/mcp",
    });
  });

  it("normalizes full MCP URLs for OAuth-native Claude Code entries", async () => {
    const root = tmpDir();
    process.chdir(root);
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toBe(
        "https://mail.agent-native.com/.well-known/oauth-protected-resource",
      );
      return new Response(
        JSON.stringify({
          resource: "https://mail.agent-native.com/_agent-native/mcp",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await runConnect(
      [
        "https://mail.agent-native.com/_agent-native/mcp",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ],
      { fetchImpl },
    );

    expect(process.exitCode).toBeFalsy();
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "https://mail.agent-native.com/_agent-native/mcp",
    });
  });

  it("rejects OAuth-native config when MCP metadata is unavailable", async () => {
    const root = tmpDir();
    process.chdir(root);
    const fetchImpl = vi.fn(
      async () => new Response("not found", { status: 404 }),
    );

    await runConnect(
      [
        "https://mail.agent-native.com",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ],
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(process.exitCode).toBe(1);
    expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
  });

  it("upgrades existing Claude bearer entries to OAuth-native config", async () => {
    const root = tmpDir();
    process.chdir(root);
    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            "agent-native-mail": {
              type: "http",
              url: "https://mail.agent-native.com/_agent-native/mcp",
              headers: { Authorization: "Bearer old-connect-token" },
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          resource: "https://mail.agent-native.com/_agent-native/mcp",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await runConnect(
      [
        "https://mail.agent-native.com",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ],
      { fetchImpl },
    );

    expect(process.exitCode).toBeFalsy();
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "https://mail.agent-native.com/_agent-native/mcp",
    });
    const joinedOutput = output.join("");
    expect(joinedOutput).toContain("Replaced legacy bearer headers");
    expect(joinedOutput).toContain("run /mcp");
  });

  it("uses OAuth for Claude clients and bearer fallback for legacy clients", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const fetchImpl = makeFetch([
      {
        status: "approved",
        token: "tok-device",
        mcpUrl: "https://mail.agent-native.com/_agent-native/mcp",
        serverName: "agent-native-mail",
      },
    ]);

    try {
      await runConnect(
        [
          "https://mail.agent-native.com",
          "--client",
          "all",
          "--scope",
          "project",
        ],
        { fetchImpl, sleep: noopSleep, openBrowser: vi.fn() },
      );

      expect(process.exitCode).toBeFalsy();
      const claudeCfg = JSON.parse(
        fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
      );
      expect(claudeCfg.mcpServers["agent-native-mail"]).toEqual({
        type: "http",
        url: "https://mail.agent-native.com/_agent-native/mcp",
      });
      const codexToml = fs.readFileSync(
        path.join(home, ".codex", "config.toml"),
        "utf-8",
      );
      expect(codexToml).toContain('"Authorization" = "Bearer tok-device"');
      expect(codexToml).not.toContain("X-Agent-Native-MCP-Full-Catalog");
      const coworkCfg = JSON.parse(
        fs.readFileSync(path.join(home, ".cowork", "mcp.json"), "utf-8"),
      );
      expect(coworkCfg.mcpServers["agent-native-mail"].headers).toEqual({
        Authorization: "Bearer tok-device",
      });
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("rejects mixed-client config when OAuth metadata is unavailable", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/device/start")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-123",
            user_code: "WXYZ-1234",
            verification_uri: "https://mail.agent-native.com/connect",
            verification_uri_complete:
              "https://mail.agent-native.com/connect?code=WXYZ-1234",
            interval: 1,
            expires_in: 600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).endsWith("/device/poll")) {
        return new Response(
          JSON.stringify({
            status: "approved",
            token: "tok-device",
            mcpUrl: "https://mail.agent-native.com/_agent-native/mcp",
            serverName: "agent-native-mail",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      await runConnect(
        [
          "https://mail.agent-native.com",
          "--client",
          "all",
          "--scope",
          "project",
        ],
        { fetchImpl, sleep: noopSleep, openBrowser: vi.fn() },
      );

      expect(process.exitCode).toBe(1);
      expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
      expect(fs.existsSync(path.join(home, ".codex", "config.toml"))).toBe(
        false,
      );
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("prompts for target clients when --client is omitted and saves the choice", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    const oldCi = process.env.CI;
    const preferencesFile = path.join(root, "prefs", "connect.json");
    process.env.HOME = home;
    process.env.CI = "true";
    process.chdir(root);

    const promptClients = vi.fn(async (context) => {
      expect(context.initialClients).toEqual(resolveClients("all"));
      expect(context.preferencesFile).toBe(preferencesFile);
      return ["codex" as const];
    });

    try {
      await runConnect(
        [
          "https://mail.agent-native.com",
          "--scope",
          "project",
          "--token",
          "tok-fallback",
        ],
        {
          isInteractive: () => true,
          promptClients,
          preferencesFile,
        },
      );

      expect(promptClients).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(fs.readFileSync(preferencesFile, "utf-8")),
      ).toMatchObject({ defaultClients: ["codex"] });
      expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
      const codexToml = fs.readFileSync(
        path.join(home, ".codex", "config.toml"),
        "utf-8",
      );
      expect(codexToml).toContain('[mcp_servers."agent-native-mail"]');
    } finally {
      process.env.HOME = oldHome;
      if (oldCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = oldCi;
      }
    }
  });

  it("preselects saved client preferences on future interactive runs", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    const preferencesFile = path.join(root, "prefs", "connect.json");
    fs.mkdirSync(path.dirname(preferencesFile), { recursive: true });
    fs.writeFileSync(
      preferencesFile,
      JSON.stringify({ defaultClients: ["codex", "cowork"] }),
    );
    process.env.HOME = home;
    process.chdir(root);

    const promptClients = vi.fn(async (context) => {
      expect(context.initialClients).toEqual(["codex", "cowork"]);
      return ["cowork" as const];
    });

    try {
      await runConnect(
        [
          "https://mail.agent-native.com",
          "--scope",
          "project",
          "--token",
          "tok-fallback",
        ],
        {
          isInteractive: () => true,
          promptClients,
          preferencesFile,
        },
      );

      expect(
        JSON.parse(fs.readFileSync(preferencesFile, "utf-8")),
      ).toMatchObject({ defaultClients: ["cowork"] });
      const coworkJson = JSON.parse(
        fs.readFileSync(path.join(home, ".cowork", "mcp.json"), "utf-8"),
      );
      expect(coworkJson.mcpServers["agent-native-mail"].headers).toEqual({
        Authorization: "Bearer tok-fallback",
      });
      expect(fs.existsSync(path.join(home, ".codex", "config.toml"))).toBe(
        false,
      );
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("keeps --client explicit and skips the saved picker preference", async () => {
    const root = tmpDir();
    const preferencesFile = path.join(root, "prefs", "connect.json");
    process.chdir(root);
    const promptClients = vi.fn(async () => ["codex" as const]);

    await runConnect(
      [
        "https://mail.agent-native.com",
        "--client",
        "claude-code",
        "--scope",
        "project",
        "--token",
        "tok-fallback",
      ],
      {
        isInteractive: () => true,
        promptClients,
        preferencesFile,
      },
    );

    expect(promptClients).not.toHaveBeenCalled();
    expect(fs.existsSync(preferencesFile)).toBe(false);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(Object.keys(cfg.mcpServers)).toEqual(["agent-native-mail"]);
  });

  it("prompts for hosted apps when no URL is provided", async () => {
    const root = tmpDir();
    process.chdir(root);
    const promptHostedApps = vi.fn(async (context) => {
      const names = context.apps.map((app) => app.name);
      expect(names).toContain("calendar");
      expect(names).toContain("mail");
      expect(names).not.toContain("voice");
      expect(context.initialApps).toEqual(names);
      return ["mail", "calendar"];
    });

    await runConnect(
      ["--client", "claude-code", "--scope", "project", "--token", "tok"],
      {
        isInteractive: () => true,
        promptHostedApps,
      },
    );

    expect(process.exitCode).toBeFalsy();
    expect(promptHostedApps).toHaveBeenCalledTimes(1);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers["agent-native-calendar"]).toEqual({
      type: "http",
      url: "https://calendar.agent-native.com/_agent-native/mcp",
      headers: {
        Authorization: "Bearer tok",
      },
    });
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "https://mail.agent-native.com/_agent-native/mcp",
      headers: {
        Authorization: "Bearer tok",
      },
    });
  });

  it("exits cleanly when the hosted app picker is cancelled", async () => {
    const root = tmpDir();
    process.chdir(root);
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await runConnect([], {
      isInteractive: () => true,
      promptHostedApps: vi.fn(async () => null),
    });

    expect(process.exitCode).toBeFalsy();
    expect(err.mock.calls.flat().join("")).not.toContain("Missing app URL");
    expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
  });

  it("switches a JSON client entry to dev and restores the saved prod entry", async () => {
    const root = tmpDir();
    const profilesFile = path.join(root, "profiles.json");
    process.chdir(root);
    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            "agent-native-mail": {
              type: "http",
              url: "https://mail.agent-native.com/_agent-native/mcp",
              headers: {
                Authorization: `Bearer ${fakeJwt("u@example.com")}`,
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const fetchImpl = vi.fn(async () => {
      throw new Error("gateway not running");
    }) as unknown as typeof fetch;

    await runConnect(
      [
        "dev",
        "--apps",
        "mail",
        "--client",
        "claude-code",
        "--scope",
        "project",
        "--gateway",
        "http://127.0.0.1:8080",
      ],
      { fetchImpl, profilesFile },
    );

    let cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "http://127.0.0.1:8080/mail/_agent-native/mcp",
      headers: {
        "X-Agent-Native-Owner-Email": "u@example.com",
      },
    });
    const savedProfiles = JSON.parse(fs.readFileSync(profilesFile, "utf-8"));
    const savedJsonEntries =
      savedProfiles.prodEntries["agent-native-mail"]["claude-code"];
    expect(Object.values(savedJsonEntries)).toEqual([
      expect.objectContaining({
        kind: "json",
        entry: expect.objectContaining({
          url: "https://mail.agent-native.com/_agent-native/mcp",
        }),
      }),
    ]);

    await runConnect(
      [
        "prod",
        "--apps",
        "mail",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ],
      { profilesFile },
    );

    cfg = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"));
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "https://mail.agent-native.com/_agent-native/mcp",
      headers: {
        Authorization: `Bearer ${fakeJwt("u@example.com")}`,
      },
    });
  });

  it("switches a Codex entry to dev and restores the raw production block", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    const profilesFile = path.join(root, "profiles.json");
    const codexFile = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(
      codexFile,
      [
        '[mcp_servers."agent-native-mail"]',
        'url = "https://mail.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer prod-token" }',
        "",
      ].join("\n"),
    );
    process.env.HOME = home;
    process.chdir(root);

    try {
      await runConnect(
        [
          "dev",
          "--apps",
          "mail",
          "--client",
          "codex",
          "--gateway",
          "http://127.0.0.1:8080",
          "--owner-email",
          "u@example.com",
        ],
        {
          profilesFile,
          fetchImpl: vi.fn(async () => {
            throw new Error("gateway not running");
          }) as unknown as typeof fetch,
        },
      );

      let toml = fs.readFileSync(codexFile, "utf-8");
      expect(toml).toContain(
        'url = "http://127.0.0.1:8080/mail/_agent-native/mcp"',
      );
      expect(toml).toContain('"X-Agent-Native-Owner-Email" = "u@example.com"');
      expect(toml).not.toContain("X-Agent-Native-MCP-Full-Catalog");

      await runConnect(["prod", "--apps", "mail", "--client", "codex"], {
        profilesFile,
      });

      toml = fs.readFileSync(codexFile, "utf-8");
      expect(toml).toContain(
        'url = "https://mail.agent-native.com/_agent-native/mcp"',
      );
      expect(toml).toContain('"Authorization" = "Bearer prod-token"');
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("sets a non-zero exit code when no url and not --all", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runConnect([]);
    expect(process.exitCode).toBe(1);
  });

  it("sets a non-zero exit code when the legacy device flow fails", async () => {
    const root = tmpDir();
    process.chdir(root);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runConnect(["https://app.example.com", "--client", "codex"], {
      fetchImpl: makeFetch([{ status: "expired" }]),
      sleep: noopSleep,
      openBrowser: vi.fn(),
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints help and exits cleanly for --help", async () => {
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await runConnect(["--help"]);
    expect(process.exitCode).toBeFalsy();
    expect(out.mock.calls.flat().join("")).toContain(
      "npx @agent-native/core@latest connect",
    );
  });
});

// ---------------------------------------------------------------------------
// runConnect --service-token (org service-token mint for CI)
// ---------------------------------------------------------------------------

describe("runConnect --service-token", () => {
  const originalExitCode = process.exitCode;
  const originalCwd = process.cwd();

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.chdir(originalCwd);
  });

  /**
   * Fetch stub for the full mint flow: device start → poll (approved with a
   * personal bearer grant) → POST to the create-org-service-token action.
   * Captures the action request so tests can assert auth + body.
   */
  function makeServiceTokenFetch(
    actionResponse: { status: number; json: unknown },
    captured: { url?: string; auth?: string; body?: any },
  ): typeof fetch {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/device/start")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-123",
            user_code: "WXYZ-1234",
            verification_uri: "https://plan.example.com/connect",
            verification_uri_complete:
              "https://plan.example.com/connect?code=WXYZ-1234",
            interval: 1,
            expires_in: 600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.endsWith("/device/poll")) {
        return new Response(
          JSON.stringify({
            status: "approved",
            token: "personal-grant-token",
            mcpUrl: "https://plan.example.com/_agent-native/mcp",
            serverName: "agent-native-plan",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.endsWith("/_agent-native/actions/create-org-service-token")) {
        captured.url = u;
        captured.auth = (
          init?.headers as Record<string, string>
        )?.authorization;
        captured.body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify(actionResponse.json), {
          status: actionResponse.status,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    }) as unknown as typeof fetch;
  }

  it("authenticates via the device flow, mints, and prints the token exactly once", async () => {
    const root = tmpDir();
    process.chdir(root);
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const captured: { url?: string; auth?: string; body?: any } = {};

    await runConnect(
      [
        "https://plan.example.com",
        "--service-token",
        "PR Recap",
        "--ttl-days",
        "90",
      ],
      {
        fetchImpl: makeServiceTokenFetch(
          {
            status: 200,
            json: {
              token: "svc-token-value-shown-once",
              id: "tok-1",
              serviceName: "pr-recap",
              serviceEmail: "svc-pr-recap@service.org_1",
              orgId: "org_1",
              ttlDays: 90,
            },
          },
          captured,
        ),
        sleep: noopSleep,
        openBrowser: vi.fn(),
      },
    );

    expect(process.exitCode).toBeFalsy();
    // The action call is authenticated with the device-flow grant.
    expect(captured.auth).toBe("Bearer personal-grant-token");
    expect(captured.body).toEqual({ name: "PR Recap", ttlDays: 90 });

    const printed = out.mock.calls.flat().join("");
    // Token printed exactly once, with PLAN_RECAP_TOKEN guidance.
    expect(printed.split("svc-token-value-shown-once").length - 1).toBe(1);
    expect(printed).toContain("PLAN_RECAP_TOKEN");
    expect(printed).toContain("svc-pr-recap@service.org_1");

    // No local MCP config is written by the service-token path.
    expect(fs.existsSync(path.join(root, ".mcp.json"))).toBe(false);
  });

  it("fails with a role hint when the server returns 403", async () => {
    const root = tmpDir();
    process.chdir(root);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const captured: { url?: string; auth?: string; body?: any } = {};

    await runConnect(["https://plan.example.com", "--service-token", "ci"], {
      fetchImpl: makeServiceTokenFetch(
        {
          status: 403,
          json: {
            error:
              "Only org owners or admins can create or revoke service tokens.",
          },
        },
        captured,
      ),
      sleep: noopSleep,
      openBrowser: vi.fn(),
    });

    expect(process.exitCode).toBe(1);
    const printedErr = err.mock.calls.flat().join("");
    expect(printedErr).toContain("owners or admins");
  });

  it("requires a URL", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runConnect(["--service-token", "ci"]);
    expect(process.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// URL-based reconnect discovery
// ---------------------------------------------------------------------------

describe("reconnect — URL-based discovery", () => {
  const originalExitCode = process.exitCode;
  const originalCwd = process.cwd();

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.chdir(originalCwd);
  });

  it("finds the canonical 'plan' entry (not prefixed agent-native-) by MCP URL pattern", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const codexFile = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    // Entry named 'plan' — old prefix scan ('agent-native-') would miss this.
    fs.writeFileSync(
      codexFile,
      [
        '[mcp_servers."plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer old-token" }',
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      await runConnect(["reconnect", "--client", "codex"], {
        fetchImpl: makeFetch([
          {
            status: "approved",
            token: "refreshed-token",
            mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
            serverName: "plan",
          },
        ]),
        sleep: noopSleep,
        openBrowser: vi.fn(),
      });

      expect(process.exitCode).toBeFalsy();
      const toml = fs.readFileSync(codexFile, "utf-8");
      expect(toml).toContain('[mcp_servers."plan"]');
      expect(toml).toContain('"Authorization" = "Bearer refreshed-token"');
      expect(toml).not.toContain("old-token");
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("removes alias duplicates when connecting (same URL, different name)", async () => {
    const root = tmpDir();
    process.chdir(root);
    // Pre-seed the config with both the canonical 'plan' entry and a stale
    // 'agent-native-plans' alias pointing at the same MCP URL.
    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            plan: {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
            "agent-native-plans": {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    await runConnect([
      "https://plan.agent-native.com",
      "--client",
      "claude-code",
      "--scope",
      "project",
      "--name",
      "plan",
      "--token",
      "tok-fresh",
    ]);

    expect(process.exitCode).toBeFalsy();
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    // Canonical entry should be present and updated.
    expect(cfg.mcpServers["plan"]).toMatchObject({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });
    // Alias duplicate must have been removed.
    expect(cfg.mcpServers).not.toHaveProperty("agent-native-plans");
  });

  it("reconnect falls back to bearer auth when OAuth metadata is temporarily unavailable", async () => {
    const root = tmpDir();
    process.chdir(root);
    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            plan: {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
            "agent-native-plans": {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/.well-known/oauth-protected-resource")) {
        return new Response("not found", { status: 404 });
      }
      if (String(url).endsWith("/device/start")) {
        return new Response(
          JSON.stringify({
            device_code: "dev-123",
            user_code: "WXYZ-1234",
            verification_uri: "https://plan.agent-native.com/connect",
            verification_uri_complete:
              "https://plan.agent-native.com/connect?code=WXYZ-1234",
            interval: 1,
            expires_in: 600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).endsWith("/device/poll")) {
        return new Response(
          JSON.stringify({
            status: "approved",
            token: "tok-fallback",
            mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
            serverName: "plan",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await runConnect(
      [
        "reconnect",
        "https://plan.agent-native.com",
        "--client",
        "claude-code",
        "--scope",
        "project",
      ],
      { fetchImpl, sleep: noopSleep, openBrowser: vi.fn() },
    );

    expect(process.exitCode).toBeFalsy();
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, ".mcp.json"), "utf-8"),
    );
    expect(cfg.mcpServers.plan).toMatchObject({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
      headers: {
        Authorization: "Bearer tok-fallback",
      },
    });
    expect(cfg.mcpServers).not.toHaveProperty("agent-native-plans");
    expect(output.join("")).toContain(
      "OAuth metadata was unavailable; falling back to bearer-token reconnect",
    );
  });

  it("auto-selects canonical 'plan' when entries are ordered [agent-native-plan, agent-native-plans, plan] for the same URL", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);
    const codexFile = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    // Three entries for the same MCP URL, worst-case ordering: canonical last.
    fs.writeFileSync(
      codexFile,
      [
        '[mcp_servers."agent-native-plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer old1" }',
        "",
        '[mcp_servers."agent-native-plans"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer old2" }',
        "",
        '[mcp_servers."plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'http_headers = { "Authorization" = "Bearer old3" }',
        "",
      ].join("\n"),
      "utf-8",
    );

    try {
      await runConnect(["reconnect", "--client", "codex"], {
        fetchImpl: makeFetch([
          {
            status: "approved",
            token: "refreshed-token",
            mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
            serverName: "plan",
          },
        ]),
        sleep: noopSleep,
        openBrowser: vi.fn(),
      });

      expect(process.exitCode).toBeFalsy();
      const toml = fs.readFileSync(codexFile, "utf-8");
      // The canonical 'plan' entry must have been refreshed.
      expect(toml).toContain('[mcp_servers."plan"]');
      expect(toml).toContain('"Authorization" = "Bearer refreshed-token"');
    } finally {
      process.env.HOME = oldHome;
    }
  });

  it("non-TTY multi-URL reconnect lists paste-ready commands", async () => {
    const root = tmpDir();
    const home = tmpDir();
    const oldHome = process.env.HOME;
    process.env.HOME = home;
    process.chdir(root);

    // Seed two DIFFERENT agent-native apps.
    const claudeFile = path.join(home, ".claude.json");
    fs.writeFileSync(
      claudeFile,
      JSON.stringify(
        {
          mcpServers: {
            plan: {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
            "agent-native-mail": {
              type: "http",
              url: "https://mail.agent-native.com/_agent-native/mcp",
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    const errLines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      errLines.push(String(chunk));
      return true;
    });

    try {
      await runConnect(["reconnect", "--client", "claude-code"], {
        isInteractive: () => false,
      });

      expect(process.exitCode).toBe(1);
      const combined = errLines.join("");
      // Should mention both apps.
      expect(combined).toContain("plan.agent-native.com");
      expect(combined).toContain("mail.agent-native.com");
      // Should include paste-ready reconnect hints.
      expect(combined).toMatch(/npx -y @agent-native\/core@latest reconnect/);
    } finally {
      process.env.HOME = oldHome;
    }
  });
});
