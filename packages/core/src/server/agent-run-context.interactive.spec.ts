import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBrowserCookieSessionMock = vi.hoisted(() => vi.fn());
const hasSameOriginBrowserEvidenceMock = vi.hoisted(() => vi.fn());

vi.mock("./auth.js", () => ({
  getSession: vi.fn(async () => null),
  getBrowserCookieSession: getBrowserCookieSessionMock,
}));

vi.mock("./loopback.js", () => ({
  isDirectLoopbackRequest: () => false,
  isLoopbackRequest: () => false,
}));

vi.mock("./request-origin.js", () => ({
  getForwardedRequestOrigin: () => "http://localhost:3000",
  hasSameOriginBrowserEvidence: hasSameOriginBrowserEvidenceMock,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: async () => ({ orgId: null }),
  resolveOrgScopeForEmail: async () => ({ status: "personal" }),
  hasOrgScopeResolutionUnavailable: () => false,
  getOrgScopeResolutionError: () => undefined,
  hasForbiddenOrgScope: () => false,
}));

vi.mock("../agent/run-store.js", () => ({
  getTurnInitiatorByRun: async () => null,
}));

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/store.js";
import {
  isDurableProviderInteractiveScope,
  isProviderInteractiveScope,
  runWithDurableTurnToolScope,
} from "../provider-api/interactive-scope.js";
import {
  runWithAgentRunContext,
  VERIFIED_TURN_GRANT_CONTEXT_KEY,
} from "./agent-run-context.js";

const OWNER = "alice@example.com";

function chatEvent(headers: Record<string, string> = {}): any {
  return {
    context: {},
    method: "POST",
    req: new Request("http://localhost:3000/_agent-native/agent-chat", {
      method: "POST",
      headers,
    }),
    headers: new Headers(headers),
  };
}

function interactiveDuring(
  event: any,
  options: { anonymous?: boolean; isBackgroundWorker?: boolean } = {},
) {
  return runWithAgentRunContext(
    {
      event,
      ownerContext: { owner: OWNER, anonymous: options.anonymous ?? false },
      ...(options.isBackgroundWorker ? { isBackgroundWorker: true } : {}),
    },
    () => isProviderInteractiveScope(),
  );
}

describe("interactive chat turns", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    getBrowserCookieSessionMock.mockReset();
    hasSameOriginBrowserEvidenceMock.mockReset();
    getBrowserCookieSessionMock.mockResolvedValue({ email: OWNER });
    hasSameOriginBrowserEvidenceMock.mockReturnValue(true);
  });
  afterEach(() => resetAppConfigForTests());

  it("leaves chat turns unmarked unless the app opts in", async () => {
    expect(await interactiveDuring(chatEvent())).toBe(false);
    expect(getBrowserCookieSessionMock).not.toHaveBeenCalled();
  });

  it("marks the owner's same-origin browser turn interactive when opted in", async () => {
    defineAppConfig({ agent: { interactiveChatTurns: true } });
    expect(await interactiveDuring(chatEvent())).toBe(true);
  });

  it.each([
    ["a bearer-token caller", { authorization: "Bearer token" }, {}],
    ["a prefetch", { "sec-purpose": "prefetch" }, {}],
    ["an anonymous owner", {}, { anonymous: true }],
  ])("does not mark %s", async (_label, headers, options) => {
    defineAppConfig({ agent: { interactiveChatTurns: true } });
    expect(await interactiveDuring(chatEvent(headers), options)).toBe(false);
  });

  it("does not mark a turn from another origin or another person's session", async () => {
    defineAppConfig({ agent: { interactiveChatTurns: true } });
    hasSameOriginBrowserEvidenceMock.mockReturnValueOnce(false);
    expect(await interactiveDuring(chatEvent())).toBe(false);
    getBrowserCookieSessionMock.mockResolvedValueOnce({
      email: "mallory@example.com",
    });
    expect(await interactiveDuring(chatEvent())).toBe(false);
  });

  it("scopes a durable run's own tool calls with the verified turn grant", async () => {
    defineAppConfig({ agent: { interactiveChatTurns: true } });
    const event = chatEvent();
    event.context[VERIFIED_TURN_GRANT_CONTEXT_KEY] = {
      runId: "run-1",
      turnId: "turn-1",
      owner: OWNER,
      expiresAt: Date.now() + 60_000,
    };
    const signal = new AbortController().signal;
    const seen = await runWithAgentRunContext(
      {
        event,
        ownerContext: { owner: OWNER, anonymous: false },
        isBackgroundWorker: true,
      },
      async () => ({
        own: await runWithDurableTurnToolScope(
          () => isDurableProviderInteractiveScope(),
          signal,
          { runId: "run-1", turnId: "turn-1", owner: OWNER },
        ),
        otherTurn: await runWithDurableTurnToolScope(
          () => isDurableProviderInteractiveScope(),
          signal,
          { runId: "run-1", turnId: "turn-2", owner: OWNER },
        ),
        unattended: await runWithDurableTurnToolScope(
          () => isDurableProviderInteractiveScope(),
          signal,
          {
            runId: "run-1",
            turnId: "turn-1",
            owner: OWNER,
            unattended: true,
          },
        ),
      }),
    );
    expect(seen).toEqual({ own: true, otherTurn: false, unattended: false });
    expect(getBrowserCookieSessionMock).not.toHaveBeenCalled();
  });
});
