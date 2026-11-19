import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCurrentRequestBrowserTabId,
  readAppStateForCurrentTab,
  writeAppStateForCurrentTab,
} from "../application-state/script-helpers.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "./build-server.js";

const rows = vi.hoisted(
  () =>
    new Map<string, { value: Record<string, unknown>; updatedAt: number }>(),
);
const listUpdatedAt = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../application-state/store.js", async (importActual) => ({
  ...(await importActual<typeof import("../application-state/store.js")>()),
  appStateGet: async (sessionId: string, key: string) =>
    rows.get(`${sessionId}|${key}`)?.value ?? null,
  appStatePut: async (
    sessionId: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    rows.set(`${sessionId}|${key}`, { value, updatedAt: Date.now() });
  },
  appStateListUpdatedAt: async (sessionId: string, keyPrefix: string) => {
    listUpdatedAt.calls += 1;
    return [...rows.entries()]
      .filter(([id]) => id.startsWith(`${sessionId}|${keyPrefix}`))
      .map(([id, row]) => ({
        key: id.slice(sessionId.length + 1),
        updatedAt: row.updatedAt,
      }));
  },
}));
vi.mock("../server/better-auth-instance.js", async (importActual) => ({
  ...(await importActual<typeof import("../server/better-auth-instance.js")>()),
  findBetterAuthUserIdForEmail: async () => undefined,
}));
vi.mock("../org/service-principal-policy.js", async (importActual) => ({
  ...(await importActual<
    typeof import("../org/service-principal-policy.js")
  >()),
  evaluateServicePrincipal: async () => ({ status: "not-service" }),
}));

const USER = "alice@example.com";

function put(key: string, value: Record<string, unknown>, updatedAt: number) {
  rows.set(`${USER}|${key}`, { value, updatedAt });
}

function config(): MCPConfig {
  return {
    name: "Design",
    appId: "design",
    description: "Test app",
    actions: {
      "view-screen": {
        tool: { description: "Read the screen", parameters: undefined },
        readOnly: true,
        run: async () => ({
          navigation: await readAppStateForCurrentTab("navigation"),
          designSelection: await readAppStateForCurrentTab("design-selection"),
          ownTabId: getCurrentRequestBrowserTabId(),
        }),
      } as any,
      navigate: {
        tool: { description: "Navigate", parameters: undefined },
        run: async () => {
          await writeAppStateForCurrentTab("navigate", { designId: "c" });
          return "Navigating to design c";
        },
      } as any,
      ping: {
        tool: { description: "Ping", parameters: undefined },
        readOnly: true,
        run: async () => "pong",
      } as any,
    },
  };
}

async function clientFor(identity: MCPCallerIdentity) {
  const server = await createMCPServerForRequest(config(), identity, {
    origin: "http://localhost:8100",
    transport: "http",
    fullCatalog: true,
  } as any);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

const userIdentity: MCPCallerIdentity = {
  userEmail: USER,
  identityAssurance: "user",
  orgId: "org_1",
  orgDomain: undefined,
};

function texts(result: unknown): string[] {
  return ((result as { content: Array<{ text?: string }> }).content ?? []).map(
    (item) => item.text ?? "",
  );
}

beforeEach(async () => {
  rows.clear();
  listUpdatedAt.calls = 0;
  const { browserTabUsedKey } =
    await import("../application-state/last-used-tab.js");
  const now = Date.now();
  // The account-wide navigation no tab has written since Sep 1, while every
  // tab still copies its selection to the account-wide row.
  put("navigation", { view: "editor", designId: "a" }, now - 60 * 86_400_000);
  put("design-selection", { designId: "b" }, now - 1_000);
  put("navigation:tab-b", { view: "editor", designId: "b" }, now - 1_000);
  put("design-selection:tab-b", { designId: "b" }, now - 1_000);
  put(browserTabUsedKey("tab-old"), { usedAt: 0 }, now - 3_600_000);
  put(browserTabUsedKey("tab-b"), { usedAt: 0 }, now - 120_000);
});

describe("MCP tool calls and the user's last-used tab", () => {
  it("reads the screen of the tab the user used last, not the stale account-wide navigation", async () => {
    const client = await clientFor(userIdentity);

    const result = await client.callTool({ name: "view-screen" });

    const [body, note] = texts(result);
    expect(JSON.parse(body!)).toEqual({
      navigation: { view: "editor", designId: "b" },
      designSelection: { designId: "b" },
      // The call reads that tab's state without becoming that tab.
      ownTabId: null,
    });
    expect(note).toMatch(
      /most recently used tab of this app \(last used 2 min ago\)/,
    );
  });

  it("sends navigate to that tab and says the move isn't confirmed", async () => {
    const client = await clientFor(userIdentity);

    const result = await client.callTool({ name: "navigate" });

    expect(rows.get(`${USER}|navigate:tab-b`)?.value).toEqual({
      designId: "c",
    });
    expect(rows.has(`${USER}|navigate`)).toBe(false);
    expect(texts(result).at(-1)).toMatch(/doesn't confirm that it moved/);
  });

  it("reads no navigation and says so when no tab was used in the last 12 hours", async () => {
    for (const key of [...rows.keys()]) {
      if (key.includes("browser-tab-used")) rows.delete(key);
    }
    const client = await clientFor(userIdentity);

    const result = await client.callTool({ name: "view-screen" });

    const [body, note] = texts(result);
    expect(JSON.parse(body!)).toMatchObject({ navigation: null });
    expect(note).toMatch(/no tab of this app was used in the last 12 hours/);
  });

  it("looks nothing up and adds no note for a call that doesn't touch tab state", async () => {
    const client = await clientFor(userIdentity);

    const result = await client.callTool({ name: "ping" });

    expect(texts(result)).toEqual(["pong"]);
    expect(listUpdatedAt.calls).toBe(0);
  });

  it("looks the tab up once per call", async () => {
    const client = await clientFor(userIdentity);

    await client.callTool({ name: "view-screen" });
    await client.callTool({ name: "view-screen" });

    expect(listUpdatedAt.calls).toBe(2);
  });

  it("leaves a service principal's call on the account-wide rows", async () => {
    const client = await clientFor({
      userEmail: USER,
      identityAssurance: "service",
      orgId: "org_1",
      orgDomain: undefined,
    });

    const result = await client.callTool({ name: "view-screen" });

    const texts_ = texts(result);
    expect(JSON.parse(texts_[0]!)).toMatchObject({
      navigation: { designId: "a" },
    });
    expect(texts_).toHaveLength(1);
    expect(listUpdatedAt.calls).toBe(0);
  });
});
