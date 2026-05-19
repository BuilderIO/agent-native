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
  writeConfigs,
} from "./connect.js";

const tmpRoots: string[] = [];

beforeEach(() => {
  // Keep CLI output out of the test log; individual tests that assert on
  // output re-spy with their own captured implementation.
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
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
  it("expands 'all' to every supported client", () => {
    expect(resolveClients("all")).toEqual([
      "claude-code",
      "claude-code-cli",
      "codex",
      "cowork",
    ]);
  });

  it("returns a single client when named", () => {
    expect(resolveClients("codex")).toEqual(["codex"]);
  });

  it("throws on an unknown client", () => {
    expect(() => resolveClients("vim")).toThrow(/Unknown --client/);
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

  it("returns null immediately when polling gets a server error", async () => {
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
    expect(pollCount).toBe(1);
    expect(err.mock.calls.flat().join("")).toContain("database unavailable");
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
        { status: 200, headers: { "content-type": "application/json" } },
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
    const codexFile = path.join(root, "config.toml");
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
      void codexFile;
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

  afterEach(() => {
    process.exitCode = originalExitCode;
    process.chdir(originalCwd);
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
      headers: { Authorization: "Bearer tok-fallback" },
    });
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
      headers: { Authorization: "Bearer tok" },
    });
    expect(cfg.mcpServers["agent-native-mail"]).toEqual({
      type: "http",
      url: "https://mail.agent-native.com/_agent-native/mcp",
      headers: { Authorization: "Bearer tok" },
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
      headers: { "X-Agent-Native-Owner-Email": "u@example.com" },
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

  it("sets a non-zero exit code when the device flow fails", async () => {
    const root = tmpDir();
    process.chdir(root);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runConnect(["https://app.example.com", "--client", "claude-code"], {
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
    expect(out.mock.calls.flat().join("")).toContain("agent-native connect");
  });
});
