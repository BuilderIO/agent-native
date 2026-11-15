import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createToolSearchEntry } from "../agent/tool-search.js";
import {
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "./build-server.js";
import { frameworkMcpTool } from "./framework-tools.js";

// raw-sql-ok: test doubles; `sql` is a mock function, not a statement
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  exists: vi.fn(),
  write: vi.fn(),
  collect: vi.fn(),
  sql: vi.fn(),
  lab: vi.fn(),
  overrideOrg: undefined as string | undefined,
}));
vi.mock("../server/request-context.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/request-context.js")>();
  return {
    ...actual,
    getRequestContext: () => {
      const context = actual.getRequestContext();
      return context && mocks.overrideOrg
        ? { ...context, orgId: mocks.overrideOrg }
        : context;
    },
  };
});
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: mocks.sql }),
}));
vi.mock("../labs/mcp-skill-lab.js", () => ({
  getMcpSkillLabEnabled: mocks.lab,
}));
vi.mock("../resources/mcp-memory-candidates.js", () => ({
  collectMcpMemoryCandidates: mocks.collect,
}));
vi.mock("../resources/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../resources/store.js")>()),
  readScopedResourceForMcp: (...args: unknown[]) => mocks.read(...args),
  scopedResourceExistsForMcp: (...args: unknown[]) => mocks.exists(...args),
}));
vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  findBetterAuthUserIdForEmail: vi.fn(async () => undefined),
}));
const identity: MCPCallerIdentity = {
  userEmail: "alice@example.test",
  identityAssurance: "user",
  orgId: "org-a",
};
function config(): MCPConfig {
  return {
    name: "test",
    appId: "test",
    readOnlyResources: true,
    actions: {
      resources: frameworkMcpTool({
        tool: { description: "Mutable resources" },
        run: mocks.write,
      }),
    },
  };
}
async function clientFor(
  cfg: MCPConfig,
  user: MCPCallerIdentity | undefined = identity,
  fullCatalog = false,
) {
  const server = await createMCPServerForRequest(cfg, user, {
    origin: "http://localhost:8100",
    transport: "http",
    fullCatalog,
  } as any);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}
function text(result: any) {
  return result.content.map((item: any) => item.text).join("\n");
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.overrideOrg = undefined;
  mocks.collect.mockResolvedValue([]);
  mocks.exists.mockResolvedValue(true);
  mocks.sql.mockResolvedValue({ rows: [] });
  mocks.read.mockImplementation(async () => ({
    content: `for:${getRequestContext()?.userEmail}:${getRequestContext()?.orgId}`,
  }));
});

describe("read-only MCP resources", () => {
  it("forwards MCP cancellation to a resource lookup", async () => {
    const client = await clientFor(config());
    let began!: () => void;
    let aborted!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const stopped = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    mocks.read.mockImplementation(
      async ({ signal }: { signal?: AbortSignal }) => {
        began();
        if (!signal) return new Promise(() => {});
        return new Promise((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted();
              resolve(null);
            },
            { once: true },
          ),
        );
      },
    );
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const call = client.callTool(
        {
          name: "resources",
          arguments: { action: "read", scope: "personal", path: "memory/a.md" },
        },
        { signal: controller.signal },
      );
      const rejected = expect(call).rejects.toThrow();
      await started;
      controller.abort();
      await rejected;
      await stopped;
    } finally {
      vi.useRealTimers();
    }
  }, 5000);
  it("refuses a resource read if its request context no longer matches the verified organization", async () => {
    const client = await clientFor(config());
    mocks.overrideOrg = "org-b";
    const result = await client.callTool({
      name: "resources",
      arguments: { action: "read", scope: "personal", path: "memory/a.md" },
    });
    expect(result.isError).toBe(true);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("recommends and reads an authorized scoped skill while hiding unavailable skills", async () => {
    const cfg = config();
    cfg.actions["tool-search"] = createToolSearchEntry(() => cfg.actions);
    const skillPath = "skills/reports/SKILL.md";
    const content =
      "---\nname: reports\ndescription: prepare report\nrequires-lab: reports.preview\n---\n# Report guide";
    let manifest: string | null = content;
    mocks.lab.mockResolvedValue(true);
    mocks.sql.mockImplementation(
      async ({ sql, args }: { sql: string; args: unknown[] }) => {
        const owner = args[0];
        if (owner !== "alice@example.test") return { rows: [] };
        if (sql.includes("path LIKE"))
          return { rows: [{ owner, path: skillPath }] };
        if (args[1] !== skillPath || manifest === null) return { rows: [] };
        return {
          rows: [
            {
              id: "s",
              owner,
              path: skillPath,
              content: manifest,
              content_complete: 1,
              visibility: "workspace",
              metadata: null,
            },
          ],
        };
      },
    );
    const client = await clientFor(cfg);
    const { listScopedSkillsForMcp } = await import("../resources/store.js");
    await expect(
      runWithRequestContext(
        { userEmail: identity.userEmail, orgId: identity.orgId },
        () => listScopedSkillsForMcp({ identity, scope: "personal" }),
      ),
    ).resolves.toHaveLength(1);
    const search = await client.callTool({
      name: "tool-search",
      arguments: { task: "prepare report" },
    });
    const skill = JSON.parse(text(search)).recommendations.find(
      (item: { kind: string }) => item.kind === "skill",
    );
    expect(skill).toMatchObject({
      use: {
        type: "resources",
        action: "read",
        scope: "personal",
        path: skillPath,
      },
    });
    const { type: _type, ...args } = skill.use;
    const read = await client.callTool({ name: "resources", arguments: args });
    expect(read.isError).toBeFalsy();
    expect(JSON.parse(text(read))).toEqual({ found: true, content });
    for (const state of ["lab-denied", "malformed", "missing"] as const) {
      manifest =
        state === "missing"
          ? null
          : state === "malformed"
            ? "---\n: malformed\n---\nprivate"
            : content;
      mocks.lab.mockResolvedValue(state !== "lab-denied");
      const result = await client.callTool({
        name: "tool-search",
        arguments: { task: "prepare report" },
      });
      const output = JSON.parse(text(result));
      expect(output.recommendations ?? []).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "skill",
            use: expect.objectContaining({ path: skillPath }),
          }),
        ]),
      );
      const denied = await client.callTool({
        name: "resources",
        arguments: args,
      });
      expect(denied.isError).toBe(true);
      expect(text(denied)).not.toContain("Report guide");
    }
  });
  it("does not discover or read skills for an unverified user or without read OAuth scope", async () => {
    const cfg = config();
    cfg.actions["tool-search"] = createToolSearchEntry(() => cfg.actions);
    for (const user of [
      { ...identity, identityAssurance: "organization" as const },
      { ...identity, oauthScopes: ["mcp:write"] },
    ]) {
      mocks.sql.mockClear();
      const client = await clientFor(cfg, user);
      const search = await client.callTool({
        name: "tool-search",
        arguments: { task: "prepare report" },
      });
      expect(text(search)).not.toContain("skills/reports/SKILL.md");
      const result = await client.callTool({
        name: "resources",
        arguments: {
          action: "read",
          scope: "personal",
          path: "skills/reports/SKILL.md",
        },
      });
      expect(result.isError).toBe(true);
      expect(mocks.sql).not.toHaveBeenCalled();
    }
  });
  it("requires an explicit organization or personal binding", async () => {
    for (const [orgId, allowed] of [
      [undefined, false],
      [null, true],
      ["org-a", true],
    ] as const) {
      const cfg = config();
      cfg.actions["tool-search"] = createToolSearchEntry(() => cfg.actions);
      const user = { ...identity, orgId };
      const client = await clientFor(cfg, user);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names.includes("resources")).toBe(allowed);
      mocks.collect.mockClear();
      await client.callTool({
        name: "tool-search",
        arguments: { task: "memory" },
      });
      expect(mocks.collect.mock.calls.length).toBe(allowed ? 1 : 0);
      if (allowed) {
        const read = await client.callTool({
          name: "resources",
          arguments: { action: "read", scope: "personal", path: "memory/a.md" },
        });
        expect(read.isError).toBeFalsy();
      }
    }
  });
  it("reads the same scoped memory recommended by task search and refuses a denied reader", async () => {
    const realCollector = await vi.importActual<
      typeof import("../resources/mcp-memory-candidates.js")
    >("../resources/mcp-memory-candidates.js");
    mocks.collect.mockImplementation(realCollector.collectMcpMemoryCandidates);
    mocks.read.mockImplementation(
      async ({ scope, path }: { scope: string; path: string }) => {
        if (scope !== "personal") return null;
        if (path === "memory/MEMORY.md")
          return {
            content: "- [Quiet alerts](quiet.md) — quiet alert preference",
          };
        if (path === "memory/quiet.md")
          return { content: "Synthetic preference: quiet alerts." };
        return null;
      },
    );
    const cfg = config();
    cfg.actions["tool-search"] = createToolSearchEntry(() => cfg.actions);
    const client = await clientFor(cfg);
    const search = await client.callTool({
      name: "tool-search",
      arguments: { task: "quiet alerts" },
    });
    const recommendation = JSON.parse(text(search)).recommendations.find(
      (item: { kind: string }) => item.kind === "memory",
    );
    expect(recommendation).toMatchObject({
      use: {
        type: "resources",
        action: "read",
        scope: "personal",
        path: "memory/quiet.md",
      },
    });
    const { type: _type, ...readArgs } = recommendation.use;
    const read = await client.callTool({
      name: "resources",
      arguments: readArgs,
    });
    expect(read.isError).toBeFalsy();
    expect(JSON.parse(text(read))).toEqual({
      found: true,
      content: "Synthetic preference: quiet alerts.",
    });

    mocks.read.mockClear();
    const denied = await clientFor({
      ...cfg,
      externalAgents: { denyActions: ["resources"] },
    });
    const rejected = await denied.callTool({
      name: "resources",
      arguments: readArgs,
    });
    expect(rejected.isError).toBe(true);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("collects memory only when the dedicated read action is callable, alongside host candidates", async () => {
    const cfg = config();
    cfg.actions["tool-search"] = createToolSearchEntry(() => cfg.actions);
    cfg.externalAgents = { denyActions: ["open_app"] };
    const host = vi.fn<NonNullable<MCPConfig["taskCandidates"]>>(
      async () => [],
    );
    cfg.taskCandidates = host;
    mocks.collect.mockResolvedValue([
      {
        id: "memory:quiet",
        kind: "memory",
        name: "quiet",
        description: "quiet",
        reason: "matching",
        callable: true,
        use: {
          type: "resources",
          action: "read",
          scope: "personal",
          path: "memory/quiet.md",
        },
      },
    ]);
    const client = await clientFor(cfg);
    const result = await client.callTool({
      name: "tool-search",
      arguments: { task: "quiet" },
    });
    expect(JSON.parse(text(result)).recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "memory", name: "quiet" }),
      ]),
    );
    expect(mocks.collect).toHaveBeenCalledOnce();
    expect(host).toHaveBeenCalledOnce();
    expect(host.mock.calls[0]![0].callableActionNames).not.toContain(
      "open_app",
    );

    for (const variant of [
      {
        cfg: { ...config(), externalAgents: { denyActions: ["resources"] } },
        user: identity,
      },
      { cfg: { ...config(), readOnlyResources: false }, user: identity },
      {
        cfg: config(),
        user: { ...identity, identityAssurance: "organization" as const },
      },
      {
        cfg: {
          ...config(),
          actions: {
            resources: {
              tool: { description: "other" },
              readOnly: true,
              mcpTool: true,
              run: async () => ({}),
            },
          },
        },
        user: identity,
      },
    ]) {
      variant.cfg.actions["tool-search"] = createToolSearchEntry(
        () => variant.cfg.actions,
      );
      mocks.collect.mockClear();
      const other = await clientFor(variant.cfg, variant.user);
      await other.callTool({
        name: "tool-search",
        arguments: { task: "quiet" },
      });
      expect(mocks.collect).not.toHaveBeenCalled();
    }
  });
  it("reads only explicit personal and shared scopes for a verified caller", async () => {
    const client = await clientFor(config());
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "resources",
    );
    for (const scope of ["personal", "shared"]) {
      const result = await client.callTool({
        name: "resources",
        arguments: { action: "read", scope, path: "memory/a.md" },
      });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toContain("for:alice@example.test:org-a");
      expect(mocks.read).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scope,
          path: "memory/a.md",
        }),
      );
    }
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("refuses writes, unknown fields, unsupported scopes and bad paths", async () => {
    const client = await clientFor(config());
    for (const args of [
      { action: "write", scope: "personal", path: "a", content: "x" },
      { action: "read", scope: "workspace", path: "a" },
      { action: "read", scope: "personal", path: "../a" },
      { action: "read", scope: "personal", path: "a", extra: true },
    ]) {
      const result = await client.callTool({
        name: "resources",
        arguments: args,
      });
      expect(result.isError).toBe(true);
    }
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("requires opt-in, verified identity and read OAuth scope, and respects explicit denial", async () => {
    const cases: Array<[MCPConfig, MCPCallerIdentity | undefined]> = [
      [{ ...config(), readOnlyResources: false }, identity],
      [config(), { ...identity, identityAssurance: "organization" }],
      [config(), { ...identity, oauthScopes: ["mcp:write"] }],
      [
        { ...config(), externalAgents: { denyActions: ["resources"] } },
        identity,
      ],
    ];
    for (const [cfg, user] of cases) {
      const client = await clientFor(cfg, user);
      expect(
        (await client.listTools()).tools.map((tool) => tool.name),
      ).not.toContain("resources");
    }
  });
  it("does not replace an app-owned action and removes the mutable framework action from full catalogs", async () => {
    const cfg = config();
    const appRun = vi.fn(async () => ({ value: "app" }));
    cfg.actions.resources = {
      tool: { description: "Application resources" },
      readOnly: true,
      run: appRun,
    };
    const app = await clientFor(cfg, identity, true);
    const result = await app.callTool({ name: "resources", arguments: {} });
    expect(text(result)).toContain("app");
    expect(appRun).toHaveBeenCalledOnce();
    const original = await clientFor(
      { ...config(), readOnlyResources: false },
      identity,
      true,
    );
    expect(
      (await original.listTools()).tools.map((tool) => tool.name),
    ).not.toContain("resources");
  });
  it("does not advertise a colliding app action as the trusted resource seam to task candidates", async () => {
    const cfg = config();
    const provider = vi.fn<NonNullable<MCPConfig["taskCandidates"]>>(
      async () => [],
    );
    cfg.taskCandidates = provider;
    cfg.actions.resources = {
      tool: { description: "App resource action" },
      readOnly: true,
      mcpTool: true,
      mcpApp: { compactCatalog: true },
      run: async () => ({ ok: true }),
    };
    cfg.actions["tool-search"] = createToolSearchEntry(() => cfg.actions);
    const client = await clientFor(cfg);
    const result = await client.callTool({
      name: "tool-search",
      arguments: { task: "memory" },
    });
    expect(result.isError).toBeFalsy();
    expect(provider).toHaveBeenCalledOnce();
    expect(provider.mock.calls[0]![0].callableActionNames).not.toContain(
      "resources",
    );
  });
  it("passes the dedicated resource seam to task candidates when callable", async () => {
    const cfg = config();
    const provider = vi.fn<NonNullable<MCPConfig["taskCandidates"]>>(
      async () => [],
    );
    cfg.taskCandidates = provider;
    cfg.actions["tool-search"] = createToolSearchEntry(() => cfg.actions);
    const client = await clientFor(cfg);
    await client.callTool({
      name: "tool-search",
      arguments: { task: "memory" },
    });
    expect(provider).toHaveBeenCalledOnce();
    expect(provider.mock.calls[0]![0].callableActionNames).toContain(
      "resources",
    );
  });
});
