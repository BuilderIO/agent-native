import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());
const resolveOrgScopeForEmailMock = vi.hoisted(() => vi.fn());
const hasOrgScopeResolutionUnavailableMock = vi.hoisted(() => vi.fn());
const getTurnInitiatorByRunMock = vi.hoisted(() => vi.fn());
const isLoopbackRequestMock = vi.hoisted(() => vi.fn());
const isDirectLoopbackRequestMock = vi.hoisted(() => vi.fn());
const getForwardedRequestOriginMock = vi.hoisted(() => vi.fn());

vi.mock("./auth.js", () => ({
  getSession: getSessionMock,
}));

vi.mock("./loopback.js", () => ({
  isDirectLoopbackRequest: isDirectLoopbackRequestMock,
  isLoopbackRequest: isLoopbackRequestMock,
}));

vi.mock("./request-origin.js", () => ({
  getForwardedRequestOrigin: getForwardedRequestOriginMock,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: getOrgContextMock,
  resolveOrgScopeForEmail: resolveOrgScopeForEmailMock,
  hasOrgScopeResolutionUnavailable: hasOrgScopeResolutionUnavailableMock,
}));

vi.mock("../agent/run-store.js", () => ({
  getTurnInitiatorByRun: getTurnInitiatorByRunMock,
}));

import {
  AGENT_CHAT_BROWSER_SESSION_ID_FIELD,
  AGENT_CHAT_REQUEST_CONTEXT_FIELD,
} from "../agent/durable-background.js";
import {
  resolveAgentRunOrgId,
  resolveAgentRunOrgScope,
  resolveAgentRunRequestContext,
  resolveAgentRunOwnerContext,
  runWithAgentRunContext,
  seedBackgroundAgentRunOwnerContext,
} from "./agent-run-context.js";
import { markCredentialMembershipUnavailable } from "./credential-membership-unavailable.js";
import {
  getRequestContext,
  markRequestIdentityAuthenticatedAtMs,
  getRequestOrgId,
  getRequestRunContext,
  getRequestTimezone,
  getRequestUserEmail,
  getRequestUserName,
} from "./request-context.js";

function makeEvent(
  headers: Record<string, string> = {},
  waitUntil?: (promise: Promise<unknown>) => void,
): any {
  return {
    context: {},
    headers: new Headers(headers),
    ...(waitUntil ? { req: { waitUntil } } : {}),
  };
}

describe("server/agent-run-context", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getOrgContextMock.mockReset();
    resolveOrgScopeForEmailMock.mockReset();
    hasOrgScopeResolutionUnavailableMock.mockReset();
    getTurnInitiatorByRunMock.mockReset();
    isLoopbackRequestMock.mockReset();
    isDirectLoopbackRequestMock.mockReset();
    getForwardedRequestOriginMock.mockReset();
    getSessionMock.mockResolvedValue(null);
    getOrgContextMock.mockResolvedValue({ orgId: null });
    resolveOrgScopeForEmailMock.mockResolvedValue({ status: "personal" });
    hasOrgScopeResolutionUnavailableMock.mockReturnValue(false);
    getTurnInitiatorByRunMock.mockResolvedValue(null);
    isLoopbackRequestMock.mockReturnValue(false);
    isDirectLoopbackRequestMock.mockReturnValue(false);
    getForwardedRequestOriginMock.mockReturnValue("http://localhost:3000");
  });

  it("resolves and caches a signed-in owner from the session", async () => {
    const event = makeEvent();
    getSessionMock.mockImplementation(async (event) => {
      markRequestIdentityAuthenticatedAtMs(event, "alice@example.com", 1_234);
      return {
        email: "alice@example.com",
        authUserId: "ba-user-1",
        name: "Alice",
        orgId: "org-session",
      };
    });

    const owner = await resolveAgentRunOwnerContext(event);
    const cached = await resolveAgentRunOwnerContext(event);

    expect(owner).toEqual({
      owner: "alice@example.com",
      authUserId: "ba-user-1",
      name: "Alice",
      anonymous: false,
      identityAuthenticatedAtMs: 1_234,
    });
    expect(cached).toBe(owner);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it("uses an anonymous owner only when the session is missing", async () => {
    const event = makeEvent();

    await expect(
      resolveAgentRunOwnerContext(event, {
        anonymousOwner: async () => "public-owner",
      }),
    ).resolves.toEqual({
      owner: "public-owner",
      anonymous: true,
    });
  });

  it("throws 401 when neither session nor anonymous owner exists", async () => {
    await expect(
      resolveAgentRunOwnerContext(makeEvent()),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("throws a retryable 503, not 401 or an anonymous owner, when the bearer's org membership could not be checked", async () => {
    const event = makeEvent();
    markCredentialMembershipUnavailable(event);

    await expect(
      resolveAgentRunOwnerContext(event, {
        anonymousOwner: () => "anon-visitor",
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("prefers the explicit org resolver over session and implicit org context", async () => {
    const event = makeEvent();
    getSessionMock.mockResolvedValue({ orgId: "org-session" });
    getOrgContextMock.mockResolvedValue({ orgId: "org-implicit" });

    const orgId = await resolveAgentRunOrgId({
      event,
      ownerContext: { owner: "alice@example.com", anonymous: false },
      resolveOrgId: async () => "org-explicit",
    });

    expect(orgId).toBe("org-explicit");
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(getOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });

  it("falls back to owner email when an explicit org resolver has no session org", async () => {
    const event = makeEvent();
    resolveOrgScopeForEmailMock.mockResolvedValue({
      status: "organization",
      orgId: "org-by-email",
    });

    await expect(
      resolveAgentRunOrgId({
        event,
        ownerContext: { owner: "alice@example.com", anonymous: false },
        resolveOrgId: async () => null,
      }),
    ).resolves.toBe("org-by-email");
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(getOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOrgScopeForEmailMock).toHaveBeenCalledWith(
      "alice@example.com",
    );
  });

  it("confirms personal scope after every organization lookup succeeds without an org", async () => {
    getSessionMock.mockResolvedValue({ orgId: null });
    getOrgContextMock.mockResolvedValue({ orgId: null });
    resolveOrgScopeForEmailMock.mockResolvedValue({ status: "personal" });

    await expect(
      resolveAgentRunRequestContext({
        event: makeEvent(),
        ownerContext: { owner: "alice@example.com", anonymous: false },
      }),
    ).resolves.toMatchObject({ orgId: undefined, orgScope: "personal" });
  });

  it("returns the confirmed personal scope for secondary route contexts", async () => {
    getSessionMock.mockResolvedValue({ orgId: null });
    getOrgContextMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: null,
    });
    resolveOrgScopeForEmailMock.mockResolvedValue({ status: "personal" });

    await expect(
      resolveAgentRunOrgScope({
        event: makeEvent(),
        ownerContext: { owner: "alice@example.com", anonymous: false },
      }),
    ).resolves.toEqual({ orgScope: "personal" });
  });

  it("keeps organization scope unknown when an organization lookup fails", async () => {
    getSessionMock.mockRejectedValue(new Error("session unavailable"));
    getOrgContextMock.mockRejectedValue(new Error("org store unavailable"));
    resolveOrgScopeForEmailMock.mockResolvedValue({ status: "unknown" });

    const requestContext = await resolveAgentRunRequestContext({
      event: makeEvent(),
      ownerContext: { owner: "alice@example.com", anonymous: false },
    });

    expect(requestContext.orgId).toBeUndefined();
    expect(requestContext.orgScope).toBeUndefined();
  });

  it("uses deployment engine defaults for an explicitly configured anonymous owner", async () => {
    const requestContext = await resolveAgentRunRequestContext({
      event: makeEvent(),
      ownerContext: { owner: "public-owner", anonymous: true },
    });

    expect(requestContext).toMatchObject({
      userEmail: "public-owner",
      agentRunAnonymous: true,
      defaultAgentEngineScope: "deployment",
    });
    expect(requestContext.orgScope).toBeUndefined();
    expect(requestContext.orgId).toBeUndefined();
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });

  it("keeps secondary route scope unknown when membership resolution fails", async () => {
    getSessionMock.mockRejectedValue(new Error("session unavailable"));
    getOrgContextMock.mockRejectedValue(new Error("org store unavailable"));
    resolveOrgScopeForEmailMock.mockResolvedValue({ status: "unknown" });

    await expect(
      resolveAgentRunOrgScope({
        event: makeEvent(),
        ownerContext: { owner: "alice@example.com", anonymous: false },
      }),
    ).resolves.toEqual({});
  });

  it("does not treat a swallowed membership read failure as personal scope", async () => {
    const event = makeEvent();
    getSessionMock.mockResolvedValue({ orgId: null });
    getOrgContextMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: null,
    });
    hasOrgScopeResolutionUnavailableMock.mockReturnValue(true);
    resolveOrgScopeForEmailMock.mockResolvedValue({ status: "unknown" });

    const requestContext = await resolveAgentRunRequestContext({
      event,
      ownerContext: { owner: "alice@example.com", anonymous: false },
    });

    expect(requestContext.orgId).toBeUndefined();
    expect(requestContext.orgScope).toBeUndefined();
  });

  it("falls back from session org to implicit org membership", async () => {
    const event = makeEvent();
    getSessionMock.mockResolvedValue({ orgId: null });
    getOrgContextMock.mockResolvedValue({ orgId: "org-implicit" });

    await expect(
      resolveAgentRunOrgId({
        event,
        ownerContext: { owner: "alice@example.com", anonymous: false },
      }),
    ).resolves.toBe("org-implicit");
  });

  it("resolves cookieless background org context from the verified owner email", async () => {
    const event = makeEvent();
    resolveOrgScopeForEmailMock.mockResolvedValue({
      status: "organization",
      orgId: "org-by-email",
    });

    await expect(
      resolveAgentRunOrgId({
        event,
        ownerContext: { owner: "alice@example.com", anonymous: false },
      }),
    ).resolves.toBe("org-by-email");
    expect(resolveOrgScopeForEmailMock).toHaveBeenCalledWith(
      "alice@example.com",
    );
  });

  it("does not resolve anonymous owners into org-scoped user context", async () => {
    const event = makeEvent();
    resolveOrgScopeForEmailMock.mockResolvedValue({
      status: "organization",
      orgId: "org-by-email",
    });

    await expect(
      resolveAgentRunOrgId({
        event,
        ownerContext: { owner: "public-owner", anonymous: true },
      }),
    ).resolves.toBeUndefined();
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });

  it("runs foreground and background handlers inside the resolved request context", async () => {
    const event = makeEvent({
      "x-user-timezone": "America/Los_Angeles",
      "x-agent-native-client-platform": "electron",
    });
    getSessionMock.mockResolvedValue({ orgId: "org-session" });

    const seen = await runWithAgentRunContext(
      {
        event,
        ownerContext: {
          owner: "alice@example.com",
          authUserId: "ba-user-1",
          name: "Alice",
          anonymous: false,
          identityAuthenticatedAtMs: 1_234,
        },
        isBackgroundWorker: true,
      },
      async () => ({
        userEmail: getRequestUserEmail(),
        authUserId: getRequestContext()?.authUserId,
        identityAuthenticatedAtMs:
          getRequestContext()?.identityAuthenticatedAtMs,
        userName: getRequestUserName(),
        orgId: getRequestOrgId(),
        timezone: getRequestTimezone(),
        clientPlatform: getRequestContext()?.clientPlatform,
        isBackgroundWorker: getRequestRunContext()?.isBackgroundWorker,
      }),
    );

    expect(seen).toEqual({
      userEmail: "alice@example.com",
      authUserId: "ba-user-1",
      identityAuthenticatedAtMs: 1_234,
      userName: "Alice",
      orgId: "org-session",
      timezone: "America/Los_Angeles",
      clientPlatform: "electron",
      isBackgroundWorker: true,
    });
  });

  it("captures the request origin and real-socket loopback signal for a foreground run", async () => {
    const event = makeEvent();
    getForwardedRequestOriginMock.mockReturnValue("http://127.0.0.1:8080");
    isLoopbackRequestMock.mockReturnValue(true);
    isDirectLoopbackRequestMock.mockReturnValue(true);

    const requestContext = await resolveAgentRunRequestContext({
      event,
      ownerContext: { owner: "alice@example.com", anonymous: false },
    });

    expect(requestContext).toMatchObject({
      requestOrigin: "http://127.0.0.1:8080",
      isLoopbackRequest: true,
      isDirectLoopbackRequest: true,
    });
    expect(isLoopbackRequestMock).toHaveBeenCalledWith(event);
    expect(isDirectLoopbackRequestMock).toHaveBeenCalledWith(event);
  });

  it("restores the browser session captured in a durable run payload", async () => {
    const event = makeEvent({
      "x-agent-native-session-id": "dispatch-session",
    });
    event.context.__agentChatBackgroundBody = {
      [AGENT_CHAT_BROWSER_SESSION_ID_FIELD]: "origin-session",
    };

    const requestContext = await resolveAgentRunRequestContext({
      event,
      ownerContext: { owner: "alice@example.com", anonymous: false },
      isBackgroundWorker: true,
    });

    expect(requestContext.browserSessionId).toBe("origin-session");
  });

  it("does not restore loopback eligibility from a durable payload", async () => {
    const event = makeEvent();
    event.context.__agentChatBackgroundBody = {
      [AGENT_CHAT_REQUEST_CONTEXT_FIELD]: {
        requestOrigin: "http://127.0.0.1:8080",
        isLoopbackRequest: true,
        isDirectLoopbackRequest: true,
      },
    };
    isLoopbackRequestMock.mockReturnValue(false);

    await expect(
      resolveAgentRunRequestContext({
        event,
        ownerContext: { owner: "alice@example.com", anonymous: false },
        isBackgroundWorker: true,
      }),
    ).resolves.toMatchObject({
      requestOrigin: "http://127.0.0.1:8080",
      isLoopbackRequest: false,
      isDirectLoopbackRequest: false,
    });
    expect(isLoopbackRequestMock).not.toHaveBeenCalled();
    expect(isDirectLoopbackRequestMock).not.toHaveBeenCalled();
  });

  it("does not infer durable loopback eligibility from worker request headers", async () => {
    const event = makeEvent();
    event.context.__agentChatBackgroundBody = {};
    isLoopbackRequestMock.mockReturnValue(true);

    await expect(
      resolveAgentRunRequestContext({
        event,
        ownerContext: { owner: "alice@example.com", anonymous: false },
        isBackgroundWorker: true,
      }),
    ).resolves.toMatchObject({
      isLoopbackRequest: false,
      isDirectLoopbackRequest: false,
    });
    expect(isLoopbackRequestMock).not.toHaveBeenCalled();
    expect(isDirectLoopbackRequestMock).not.toHaveBeenCalled();
  });

  it("does not use dispatch headers when the durable run had no browser session", async () => {
    const event = makeEvent({
      "x-agent-native-session-id": "dispatch-session",
    });
    event.context.__agentChatBackgroundBody = {
      [AGENT_CHAT_BROWSER_SESSION_ID_FIELD]: null,
    };

    const requestContext = await resolveAgentRunRequestContext({
      event,
      ownerContext: { owner: "alice@example.com", anonymous: false },
      isBackgroundWorker: true,
    });

    expect(requestContext.browserSessionId).toBeUndefined();
  });

  it("keeps the request-scoped waitUntil callback in the run context", async () => {
    const waitUntil = vi.fn();
    const event = makeEvent({}, waitUntil);

    await runWithAgentRunContext(
      {
        event,
        ownerContext: {
          owner: "alice@example.com",
          anonymous: false,
        },
      },
      async () => {
        expect(getRequestRunContext()?.waitUntil).toBe(waitUntil);
      },
    );
  });

  it("restores platform attribution from an authenticated background payload", async () => {
    const event = makeEvent();
    event.context.__agentNativeClientPlatform = "mobile";
    getSessionMock.mockResolvedValue({ orgId: "org-session" });

    await runWithAgentRunContext(
      {
        event,
        ownerContext: { owner: "alice@example.com", anonymous: false },
      },
      () => {
        expect(getRequestContext()?.clientPlatform).toBe("mobile");
      },
    );
  });

  it("seeds the durable worker from the persisted turn initiator", async () => {
    const event = makeEvent();
    getTurnInitiatorByRunMock.mockResolvedValue({
      email: "editor@example.com",
      authUserId: "editor-user-id",
      orgId: "editor-org",
      orgScope: null,
      anonymous: false,
      firstRunId: "run_123",
    });

    const seeded = await seedBackgroundAgentRunOwnerContext(event, "run_123");

    expect(seeded).toEqual({
      owner: "editor@example.com",
      authUserId: "editor-user-id",
      anonymous: false,
      orgId: "editor-org",
      orgScope: null,
    });
    await expect(resolveAgentRunOwnerContext(event)).resolves.toBe(seeded);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("preserves an explicitly org-less foreground initiator", async () => {
    const event = makeEvent();
    getTurnInitiatorByRunMock.mockResolvedValue({
      email: "editor@example.com",
      orgId: null,
      anonymous: false,
      firstRunId: "run_123",
    });
    resolveOrgScopeForEmailMock.mockResolvedValue({
      status: "organization",
      orgId: "org-from-another-membership",
    });

    const seeded = await seedBackgroundAgentRunOwnerContext(event, "run_123");

    await expect(
      resolveAgentRunOrgId({ event, ownerContext: seeded! }),
    ).resolves.toBeUndefined();
    const requestContext = await resolveAgentRunRequestContext({
      event,
      ownerContext: seeded!,
    });
    expect(requestContext.orgId).toBeUndefined();
    expect(requestContext.orgScope).toBeUndefined();
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });

  it("preserves a durable initiator's confirmed personal scope", async () => {
    const event = makeEvent();
    getTurnInitiatorByRunMock.mockResolvedValue({
      email: "editor@example.com",
      orgId: null,
      orgScope: "personal",
      anonymous: false,
      firstRunId: "run_123",
    });

    const seeded = await seedBackgroundAgentRunOwnerContext(event, "run_123");

    await expect(
      resolveAgentRunRequestContext({ event, ownerContext: seeded! }),
    ).resolves.toMatchObject({ orgId: undefined, orgScope: "personal" });
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });

  it("fails closed when a legacy run has no persisted initiator", async () => {
    const event = makeEvent();
    getTurnInitiatorByRunMock.mockResolvedValue(null);

    await expect(
      seedBackgroundAgentRunOwnerContext(event, "run_123"),
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: "Agent turn initiator is unavailable",
    });
    expect(resolveOrgScopeForEmailMock).not.toHaveBeenCalled();
  });
});
