import { createRequire } from "node:module";

import {
  createMCPServerForRequest,
  type MCPConfig,
} from "@agent-native/core/mcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCore = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const { Client } = requireCore("@modelcontextprotocol/client");
const { InMemoryTransport } = requireCore("@modelcontextprotocol/server");

const mocks = vi.hoisted(() => ({
  createAgentChatPlugin: vi.fn(
    (options: {
      mcp: Pick<
        MCPConfig,
        "connectorCatalog" | "externalAgents" | "instructions"
      >;
    }) => options,
  ),
  isConnected: vi.fn(),
  getAuthStatus: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  rsvpEvent: vi.fn(),
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  createAgentChatPlugin: mocks.createAgentChatPlugin,
  loadActionsFromStaticRegistry: vi.fn(() => ({})),
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));
vi.mock("@agent-native/core/event-bus", () => ({
  emit: vi.fn(),
  registerEvent: vi.fn(),
}));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));
vi.mock("../onboarding.js", () => ({}));
vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));
vi.mock("./google-calendar.js", () => ({
  isConnected: mocks.isConnected,
  getAuthStatus: mocks.getAuthStatus,
  createEvent: mocks.createEvent,
  updateEvent: mocks.updateEvent,
  rsvpEvent: mocks.rsvpEvent,
}));
vi.mock("./event-video-conferencing.js", () => ({
  shouldAutoAddGoogleMeet: vi.fn(() => false),
  prepareZoomMeetingPatch: vi.fn(),
}));

import createEvent from "../../actions/create-event.js";
import deleteEvent from "../../actions/delete-event.js";
import listEvents from "../../actions/list-events.js";
import respondToEvent from "../../actions/respond-to-event.js";
import rsvpEvent from "../../actions/rsvp-event.js";
import updateEvent from "../../actions/update-event.js";
import "../plugins/agent-chat.js";

const actions = {
  "list-events": listEvents,
  "create-event": createEvent,
  "update-event": updateEvent,
  "respond-to-event": respondToEvent,
  "rsvp-event": rsvpEvent,
  "delete-event": deleteEvent,
};
const ownerEmail = "owner@example.com";
const accountEmail = "secondary@example.com";
const createInput = {
  title: "MCP test event",
  start: "2026-10-08T16:00:00.000Z",
  end: "2026-10-08T16:30:00.000Z",
  accountEmail,
};
const writeInputs = [
  ["create-event", createInput],
  ["update-event", { id: "google-event-1", title: "Changed", accountEmail }],
  [
    "respond-to-event",
    { id: "google-occurrence-1", status: "declined", accountEmail },
  ],
] as const;
const closeClients: Array<() => Promise<void>> = [];
const askAgent = vi.fn(async () => "Unexpected delegation");
const mcp = mocks.createAgentChatPlugin.mock.calls[0][0].mcp;
type ListedTool = {
  name: string;
  annotations?: Record<string, unknown>;
  inputSchema: { properties?: Record<string, unknown> };
};

async function clientFor(
  userEmail = ownerEmail,
  oauthScopes = ["mcp:read", "mcp:write"],
) {
  const server = await createMCPServerForRequest(
    {
      name: "Calendar",
      description: "Calendar test server",
      appId: "calendar",
      actions,
      ...mcp,
      askAgent,
    },
    {
      userEmail,
      orgDomain: undefined,
      orgId: null,
      identityAssurance: "user",
      oauthScopes,
    },
    { origin: "http://localhost:8100", transport: "http" },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "calendar-write-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  closeClients.push(async () => {
    await client.close();
    await server.close();
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function expectNoWrites() {
  expect(mocks.createEvent).not.toHaveBeenCalled();
  expect(mocks.updateEvent).not.toHaveBeenCalled();
  expect(mocks.rsvpEvent).not.toHaveBeenCalled();
  expect(askAgent).not.toHaveBeenCalled();
}

describe("Calendar direct MCP writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConnected.mockResolvedValue(true);
    mocks.getAuthStatus.mockResolvedValue({
      accounts: [{ email: accountEmail }],
    });
    mocks.getUserSetting.mockResolvedValue(undefined);
    mocks.createEvent.mockResolvedValue({ id: "event-1" });
    mocks.updateEvent.mockResolvedValue({});
    mocks.rsvpEvent.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    for (const close of closeClients.splice(0)) await close();
  });

  it("advertises only curated actions with mutation annotations and single-instance RSVP", async () => {
    const client = await clientFor();
    const { tools }: { tools: ListedTool[] } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "ask_app",
      "ask_app_status",
      "create-event",
      "create_embed_session",
      "list-events",
      "list_apps",
      "open_app",
      "respond-to-event",
      "update-event",
    ]);
    for (const name of ["create-event", "update-event", "respond-to-event"]) {
      expect(
        tools.find((tool) => tool.name === name)?.annotations,
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: name !== "create-event",
      });
    }
    expect(
      tools.find((tool) => tool.name === "respond-to-event")?.inputSchema
        .properties?.scope,
    ).toMatchObject({ enum: ["single", "all"], default: "single" });
    expect(listEvents.readOnly).toBe(true);
    expect(listEvents.publicAgent).toMatchObject({
      expose: true,
      readOnly: true,
      requiresAuth: true,
    });
  });

  it("creates and updates directly using the MCP caller's owned account", async () => {
    const client = await clientFor();
    const created = await client.callTool({
      name: "create-event",
      arguments: { ...createInput, ownerEmail: "other@example.com" },
    });
    expect(created.isError).not.toBe(true);
    expect(mocks.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: createInput.title, accountEmail }),
      expect.objectContaining({ account: { ownerEmail, accountEmail } }),
    );
    const updated = await client.callTool({
      name: "update-event",
      arguments: writeInputs[1][1],
    });
    expect(updated.isError).not.toBe(true);
    expect(mocks.updateEvent).toHaveBeenCalledWith(
      "event-1",
      expect.objectContaining({ title: "Changed", accountEmail }),
      expect.objectContaining({ account: { ownerEmail, accountEmail } }),
    );
    expect(mocks.getAuthStatus).toHaveBeenCalledWith(ownerEmail, undefined);
    expect(askAgent).not.toHaveBeenCalled();
  });

  it.each([undefined, "single", "all"] as const)(
    "RSVPs with scope %s without delegating",
    async (scope) => {
      const client = await clientFor();
      const result = await client.callTool({
        name: "respond-to-event",
        arguments: {
          ...writeInputs[2][1],
          ...(scope === undefined ? {} : { scope }),
          note: "  Conflict  ",
          sendUpdates: "none",
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      expect(mocks.rsvpEvent).toHaveBeenCalledWith(
        "occurrence-1",
        "declined",
        { ownerEmail, accountEmail },
        scope ?? "single",
        "Conflict",
        "none",
      );
      expect(askAgent).not.toHaveBeenCalled();
    },
  );

  it("scopes successive clients to their respective authenticated users", async () => {
    const first = await clientFor();
    const second = await clientFor("second@example.com");
    await first.callTool({
      name: "respond-to-event",
      arguments: writeInputs[2][1],
    });
    await second.callTool({
      name: "respond-to-event",
      arguments: writeInputs[2][1],
    });
    expect(
      mocks.rsvpEvent.mock.calls.map((call) => call[2].ownerEmail),
    ).toEqual([ownerEmail, "second@example.com"]);
  });

  it("hides and refuses writes for read-only OAuth scope", async () => {
    const client = await clientFor(ownerEmail, ["mcp:read"]);
    const { tools }: { tools: ListedTool[] } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "ask_app_status",
      "list-events",
      "list_apps",
      "open_app",
    ]);
    for (const [name, args] of writeInputs) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
    }
    expectNoWrites();
  });

  it.each(writeInputs)(
    "rejects unauthenticated %s calls before provider work",
    async (name, args) => {
      const client = await clientFor("");
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expectNoWrites();
    },
  );

  it.each(writeInputs)(
    "rejects %s writes to an unowned account",
    async (name, args) => {
      const client = await clientFor();
      const result = await client.callTool({
        name,
        arguments: { ...args, accountEmail: "other@example.com" },
      });
      expect(result.isError).toBe(true);
      expectNoWrites();
    },
  );

  it.each(["update-event", "respond-to-event"])(
    "rejects shared-calendar %s writes",
    async (name) => {
      const client = await clientFor();
      const result = await client.callTool({
        name,
        arguments: {
          id: "google-google-calendar:opaque-source-shared-event",
          accountEmail,
          title: "Changed",
          status: "declined",
        },
      });
      expect(result.isError).toBe(true);
      expectNoWrites();
    },
  );

  it("retains update-event approval for attendee notifications", async () => {
    const client = await clientFor();
    const result = await client.callTool({
      name: "update-event",
      arguments: { ...writeInputs[1][1], sendUpdates: "all" },
    });
    expect(result.isError).toBe(true);
    expectNoWrites();
  });

  it("rejects invalid RSVP status and unsupported future-instance scope", async () => {
    const client = await clientFor();
    for (const patch of [{ status: "yes" }, { scope: "thisAndFollowing" }]) {
      const result = await client.callTool({
        name: "respond-to-event",
        arguments: { ...writeInputs[2][1], ...patch },
      });
      expect(result.isError).toBe(true);
    }
    expectNoWrites();
  });

  it.each(writeInputs)(
    "reports %s provider failures as errors",
    async (name, args) => {
      mocks.createEvent.mockRejectedValue(new Error("Provider unavailable"));
      mocks.updateEvent.mockRejectedValue(new Error("Provider unavailable"));
      mocks.rsvpEvent.mockRejectedValue(new Error("Provider unavailable"));
      const client = await clientFor();
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(askAgent).not.toHaveBeenCalled();
    },
  );
});
