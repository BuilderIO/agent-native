import { createRequire } from "node:module";

import {
  invocationEffect,
  isNoWriteError,
  NoWriteError,
  runActionWithExecutionOutcome,
  type ActionExecutionOutcome,
  type ActionRunContext,
} from "@agent-native/core/action";
import { createMCPServerForRequest } from "@agent-native/core/mcp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCore = createRequire(
  new URL("../../../core/package.json", import.meta.url),
);
const { Client } = requireCore("@modelcontextprotocol/client");
const { InMemoryTransport } = requireCore("@modelcontextprotocol/server");

const mocks = vi.hoisted(() => ({
  listActions: vi.fn(),
  callAction: vi.fn(),
}));

vi.mock("../server/lib/mcp-gateway.js", () => ({
  listGrantedDispatchMcpAppActions: mocks.listActions,
  callGrantedDispatchMcpAppAction: mocks.callAction,
}));

vi.mock("../../../core/src/server/action-change-marker-write.js", () => ({
  writeActionChangeMarker: vi.fn(async () => {}),
}));

import callAppAction from "./call_app_action.js";
import listAppActions from "./list_app_actions.js";
import readView from "./read_view.js";

const ctx = { caller: "mcp" } as never;

async function failedEffect(args: Record<string, unknown>) {
  const outcome: ActionExecutionOutcome = { refused: false };
  const error = await runActionWithExecutionOutcome(
    callAppAction.run as (
      args: never,
      ctx?: ActionRunContext,
    ) => Promise<never>,
    args as never,
    ctx as ActionRunContext,
    outcome,
    callAppAction,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeDefined();
  return invocationEffect(callAppAction, outcome, { failed: { error } }).effect;
}

describe("app action tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists a granted app's actions", async () => {
    mocks.listActions.mockResolvedValue([
      { name: "list-emails", description: "Inbox", inputSchema: {} },
    ]);
    const result = await listAppActions.run({ app: "mail" } as never, ctx);
    expect(mocks.listActions).toHaveBeenCalledWith("mail", undefined);
    expect(result).toEqual({
      app: "mail",
      actions: [{ name: "list-emails", description: "Inbox", inputSchema: {} }],
    });
  });

  it("calls one action with its args and defaults to none", async () => {
    mocks.callAction.mockResolvedValue({ content: [] });
    await callAppAction.run(
      { app: "mail", action: "list-emails", args: { limit: 5 } } as never,
      ctx,
    );
    expect(mocks.callAction).toHaveBeenCalledWith("mail", "list-emails", {
      limit: 5,
    });
    await callAppAction.run(
      { app: "calendar", action: "list-events" } as never,
      ctx,
    );
    expect(mocks.callAction).toHaveBeenLastCalledWith(
      "calendar",
      "list-events",
      {},
    );
  });

  it("returns complete forwarded payloads through the MCP transport", async () => {
    const payload = { decks: [{ id: "fixture-deck", body: "x".repeat(5000) }] };
    const forwarded = {
      structuredContent: payload,
      content: [{ type: "text", text: JSON.stringify(payload) }],
    };
    mocks.callAction.mockResolvedValue(forwarded);
    const server = await createMCPServerForRequest(
      {
        name: "dispatch-transport-test",
        version: "1.0.0",
        catalogMode: "app",
        builtinCrossAppTools: false,
        actions: { call_app_action: callAppAction },
      },
      undefined,
    );
    const client = new Client({ name: "transport-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    try {
      const result = await client.callTool({
        name: "call_app_action",
        arguments: { app: "slides", action: "list-decks" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(forwarded);
      mocks.callAction.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Provider rejected the action" }],
      });
      const failure = await client.callTool({
        name: "call_app_action",
        arguments: { app: "slides", action: "list-decks" },
      });
      expect(failure.isError).toBe(true);
      mocks.callAction.mockRejectedValue(
        new NoWriteError("Connect the app.", {
          errorCode: "authorization_required",
          details: {
            authorizationUrl:
              "https://dispatch.example.test/_agent-native/mcp/servers/oauth/start?name=app",
          },
        }),
      );
      const authorization = await client.callTool({
        name: "call_app_action",
        arguments: { app: "slides", action: "list-decks" },
      });
      expect(authorization.isError).toBe(true);
      expect(authorization.content).toEqual([
        expect.objectContaining({
          text: expect.stringContaining("authorization_required"),
        }),
      ]);
      expect(authorization.content).toEqual([
        expect.objectContaining({
          text: expect.stringContaining(
            "https://dispatch.example.test/_agent-native/mcp/servers/oauth/start?name=app",
          ),
        }),
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("is not a read-only tool and carries no app panel", () => {
    expect(callAppAction.readOnly).not.toBe(true);
    expect(callAppAction.mcpApp?.resource).toBeUndefined();
    expect(listAppActions.readOnly).toBe(true);
  });

  it("passes the app's real error code through instead of a generic failure", async () => {
    mocks.callAction.mockResolvedValue({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: Google Calendar requests are paused for this deployment. (errorCode: google_calendar_paused)",
        },
      ],
    });
    const error = await callAppAction
      .run({ app: "calendar", action: "create-event", args: {} } as never, ctx)
      .catch((caught: Error) => caught);
    expect(error).toMatchObject({ errorCode: "google_calendar_paused" });
    expect((error as Error).message).toMatch(
      /paused for this deployment\. Its write outcome may be unknown; inspect the app before retrying\.$/,
    );
  });

  it("reports an input-check refusal as a call that wrote nothing", async () => {
    mocks.callAction.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Error: Invalid action parameters" }],
    });
    const error = await callAppAction
      .run(
        { app: "mail", action: "send-gmail-message", args: {} } as never,
        ctx,
      )
      .catch((caught: Error) => caught);
    expect(isNoWriteError(error)).toBe(true);
    expect(
      await failedEffect({
        app: "mail",
        action: "send-gmail-message",
        args: {},
      }),
    ).toBe("none");
    expect((error as Error).message).toBe(
      "Error: Invalid action parameters Nothing was changed.",
    );
    expect(error).toMatchObject({
      errorCode: "app_action_invalid_parameters",
      statusCode: 400,
    });
  });

  it("keeps a handler failure's write outcome unknown", async () => {
    mocks.callAction.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Error: Gmail rejected the message" }],
    });
    const error = await callAppAction
      .run(
        { app: "mail", action: "send-gmail-message", args: {} } as never,
        ctx,
      )
      .catch((caught: Error) => caught);
    expect(isNoWriteError(error)).toBe(false);
    expect(
      await failedEffect({
        app: "mail",
        action: "send-gmail-message",
        args: {},
      }),
    ).toBe("unknown");
    expect((error as Error).message).toMatch(/write outcome may be unknown/);
  });

  it("reports an approval wait as approval_required with one errorCode", async () => {
    mocks.callAction.mockResolvedValue({
      isError: true,
      approvalReview: { url: "https://app.example.test/approvals/1" },
      content: [
        {
          type: "text",
          text: "manage-event is waiting for the user's decision on its review page: https://app.example.test/approvals/1",
        },
      ],
    });
    await expect(
      callAppAction.run(
        { app: "calendar", action: "manage-event", args: {} } as never,
        ctx,
      ),
    ).rejects.toMatchObject({
      errorCode: "approval_required",
      details: {
        approvalReview: { url: "https://app.example.test/approvals/1" },
      },
    });
    mocks.callAction.mockResolvedValue({
      isError: true,
      content: [
        {
          type: "text",
          text: "Paused. (errorCode: x_paused) (errorCode: x_paused)",
        },
      ],
    });
    const err = await callAppAction
      .run({ app: "a", action: "b", args: {} } as never, ctx)
      .catch((e: Error) => e);
    expect(
      (err as Error).message.match(/errorCode/g)?.length ?? 0,
    ).toBeLessThanOrEqual(1);
  });
  it("reads the app's current view through its view-screen action", async () => {
    mocks.callAction.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      structuredContent: { mailWorkspace: { openOverlay: "composer" } },
    });
    const result = await readView.run({ app: "mail" } as never, ctx);
    expect(mocks.callAction).toHaveBeenCalledWith("mail", "view-screen", {});
    expect(result).toEqual({
      app: "mail",
      view: { mailWorkspace: { openOverlay: "composer" } },
    });
  });

  it("fails loudly when the app cannot report its view", async () => {
    mocks.callAction.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Mail is not open." }],
    });
    await expect(
      readView.run({ app: "mail" } as never, ctx),
    ).rejects.toMatchObject({ errorCode: "view_unavailable" });
  });
});
