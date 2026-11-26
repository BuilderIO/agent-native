import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentNavigationRefusedError,
  assertNavigateWriteAllowed,
  evaluateNavigateWrite,
  withAuthorizedAgentNavigation,
  withAuthorizedFrameworkUrlTool,
} from "../application-state/navigate-write-guard.js";
import {
  getCurrentRequestBrowserTabId,
  resolveCurrentRequestStateTab,
} from "../application-state/script-helpers.js";
import { getRequestRunContext } from "../server/request-context.js";
import { handleJsonRpcH3, processA2ATaskFromQueue } from "./handlers.js";
import type { A2AConfig } from "./types.js";

vi.mock("../mcp/chat-turn-store.js", () => ({
  MCP_CHAT_TURN_FIELD: "__agentNativeMcpChatTurn",
  admitMcpChatTurn: vi.fn(async () => ({ status: "absent" })),
  readMcpChatTurn: vi.fn(async () => ({ status: "absent" })),
}));

vi.mock("../server/self-dispatch.js", () => ({
  fireInternalDispatch: vi.fn(async () => {}),
  canSendProcessorHandoff: () => true,
}));

function makeEvent(input: {
  email?: string;
  assurance?: "user" | "organization" | "org-member";
  headers?: Record<string, string>;
}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    node: {
      req: {
        headers: normalizedHeaders,
      },
    },
    context: {
      ...(input.email ? { __a2aVerifiedEmail: input.email } : {}),
      ...(input.assurance ? { __a2aIdentityAssurance: input.assurance } : {}),
    },
  };
}

describe("A2A x-agent-native-browser-tab and viewportMode propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates x-agent-native-browser-tab to resolveCurrentRequestStateTab on sync A2A calls without impersonating browserTabId", async () => {
    let observedStateTab: Awaited<
      ReturnType<typeof resolveCurrentRequestStateTab>
    > | null = null;
    let observedBrowserTabId: string | null = "unset";
    let observedViewportMode: string | undefined;

    const config: A2AConfig = {
      name: "Decks",
      description: "Decks app",
      handler: async () => {
        observedStateTab = await resolveCurrentRequestStateTab();
        observedBrowserTabId = getCurrentRequestBrowserTabId();
        observedViewportMode = getRequestRunContext()?.viewportMode;
        return {
          message: { role: "agent", parts: [{ type: "text", text: "ok" }] },
        };
      },
    };

    const event = makeEvent({
      email: "owner@example.test",
      assurance: "user",
      headers: {
        "x-agent-native-browser-tab": "child-tab-42",
        "x-agent-native-viewport-mode": "foreground",
      },
    });

    const res = await handleJsonRpcH3(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "open slide 2" }],
          },
        },
      },
      event,
      config,
    );

    expect(res.error).toBeUndefined();
    expect(observedStateTab).toEqual({
      tabId: "child-tab-42",
      unavailable: false,
    });
    expect(observedBrowserTabId).toBeNull();
    expect(observedViewportMode).toBe("foreground");
  });

  it("preserves browserTabId and background viewportMode across async A2A processing and blocks foreground navigation writes", async () => {
    let observedStateTab: Awaited<
      ReturnType<typeof resolveCurrentRequestStateTab>
    > | null = null;
    let observedViewportMode: string | undefined;
    let navigateRefusalReason: string | undefined;
    let frameworkUrlRefusal: unknown;

    const config: A2AConfig = {
      name: "Content",
      description: "Content app",
      handler: async () => {
        observedStateTab = await resolveCurrentRequestStateTab();
        observedViewportMode = getRequestRunContext()?.viewportMode;
        const refusal = withAuthorizedAgentNavigation(() =>
          evaluateNavigateWrite("navigate", {
            path: "/docs/secret",
            navigationMode: "open",
          }),
        );
        navigateRefusalReason = refusal?.reason;
        try {
          withAuthorizedFrameworkUrlTool(() =>
            assertNavigateWriteAllowed("__set_url__:child-tab-99", {
              pathname: "/hijack",
            }),
          );
        } catch (err) {
          frameworkUrlRefusal = err;
        }
        return {
          message: { role: "agent", parts: [{ type: "text", text: "done" }] },
        };
      },
    };

    const event = makeEvent({
      email: "owner@example.test",
      assurance: "user",
      headers: {
        "x-agent-native-browser-tab": "child-tab-99",
        "x-agent-native-viewport-mode": "background",
      },
    });

    const submitted = await handleJsonRpcH3(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "search docs in background" }],
          },
        },
      },
      event,
      config,
    );

    const taskId = (submitted.result as { id: string }).id;
    expect(taskId).toBeTruthy();

    await processA2ATaskFromQueue(taskId, config);

    expect(observedStateTab).toEqual({
      tabId: "child-tab-99",
      unavailable: false,
    });
    expect(observedViewportMode).toBe("background");
    expect(navigateRefusalReason).toBe("background-viewport-locked");
    expect(frameworkUrlRefusal).toBeInstanceOf(AgentNavigationRefusedError);
    expect((frameworkUrlRefusal as AgentNavigationRefusedError).reason).toBe(
      "background-viewport-locked",
    );
  });

  it("ignores x-agent-native-browser-tab for organization-only A2A principals", async () => {
    let observedStateTab: Awaited<
      ReturnType<typeof resolveCurrentRequestStateTab>
    > | null = null;

    const config: A2AConfig = {
      name: "Decks",
      description: "Decks app",
      handler: async () => {
        observedStateTab = await resolveCurrentRequestStateTab();
        return {
          message: { role: "agent", parts: [{ type: "text", text: "ok" }] },
        };
      },
    };

    const event = makeEvent({
      email: "org-bot@example.test",
      assurance: "organization",
      headers: {
        "x-agent-native-browser-tab": "child-tab-42",
      },
    });

    await handleJsonRpcH3(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "message/send",
        params: {
          message: { role: "user", parts: [{ type: "text", text: "ping" }] },
        },
      },
      event,
      config,
    );

    expect(observedStateTab).toEqual({ tabId: null, unavailable: false });
  });
});
