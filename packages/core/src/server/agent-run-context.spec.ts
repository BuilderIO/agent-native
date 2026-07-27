import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());
const resolveOrgIdForEmailMock = vi.hoisted(() => vi.fn());
const getRunOwnerEmailMock = vi.hoisted(() => vi.fn());

vi.mock("./auth.js", () => ({
  getSession: getSessionMock,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: getOrgContextMock,
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
}));

vi.mock("../agent/run-store.js", () => ({
  getRunOwnerEmail: getRunOwnerEmailMock,
}));

import {
  resolveAgentRunOrgId,
  resolveAgentRunOwnerContext,
  runWithAgentRunContext,
  seedBackgroundAgentRunOwnerContext,
} from "./agent-run-context.js";
import {
  getRequestOrgId,
  getRequestRunContext,
  getRequestTimezone,
  getRequestUserEmail,
  getRequestUserName,
} from "./request-context.js";

function makeEvent(headers: Record<string, string> = {}): any {
  return {
    context: {},
    headers: new Headers(headers),
  };
}

describe("server/agent-run-context", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getOrgContextMock.mockReset();
    resolveOrgIdForEmailMock.mockReset();
    getRunOwnerEmailMock.mockReset();
    getSessionMock.mockResolvedValue(null);
    getOrgContextMock.mockResolvedValue({ orgId: null });
    resolveOrgIdForEmailMock.mockResolvedValue(null);
    getRunOwnerEmailMock.mockResolvedValue(null);
  });

  it("resolves and caches a signed-in owner from the session", async () => {
    const event = makeEvent();
    getSessionMock.mockResolvedValue({
      email: "alice@example.com",
      name: "Alice",
      orgId: "org-session",
    });

    const owner = await resolveAgentRunOwnerContext(event);
    const cached = await resolveAgentRunOwnerContext(event);

    expect(owner).toEqual({
      owner: "alice@example.com",
      name: "Alice",
      anonymous: false,
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
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("falls back to owner email when an explicit org resolver has no session org", async () => {
    const event = makeEvent();
    resolveOrgIdForEmailMock.mockResolvedValue("org-by-email");

    await expect(
      resolveAgentRunOrgId({
        event,
        ownerContext: { owner: "alice@example.com", anonymous: false },
        resolveOrgId: async () => null,
      }),
    ).resolves.toBe("org-by-email");
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(getOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).toHaveBeenCalledWith("alice@example.com");
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
    resolveOrgIdForEmailMock.mockResolvedValue("org-by-email");

    await expect(
      resolveAgentRunOrgId({
        event,
        ownerContext: { owner: "alice@example.com", anonymous: false },
      }),
    ).resolves.toBe("org-by-email");
    expect(resolveOrgIdForEmailMock).toHaveBeenCalledWith("alice@example.com");
  });

  it("does not resolve anonymous owners into org-scoped user context", async () => {
    const event = makeEvent();
    resolveOrgIdForEmailMock.mockResolvedValue("org-by-email");

    await expect(
      resolveAgentRunOrgId({
        event,
        ownerContext: { owner: "public-owner", anonymous: true },
      }),
    ).resolves.toBeUndefined();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("runs foreground and background handlers inside the resolved request context", async () => {
    const event = makeEvent({ "x-user-timezone": "America/Los_Angeles" });
    getSessionMock.mockResolvedValue({ orgId: "org-session" });

    const seen = await runWithAgentRunContext(
      {
        event,
        ownerContext: {
          owner: "alice@example.com",
          name: "Alice",
          anonymous: false,
        },
        isBackgroundWorker: true,
      },
      async () => ({
        userEmail: getRequestUserEmail(),
        userName: getRequestUserName(),
        orgId: getRequestOrgId(),
        timezone: getRequestTimezone(),
        isBackgroundWorker: getRequestRunContext()?.isBackgroundWorker,
      }),
    );

    expect(seen).toEqual({
      userEmail: "alice@example.com",
      userName: "Alice",
      orgId: "org-session",
      timezone: "America/Los_Angeles",
      isBackgroundWorker: true,
    });
  });

  it("seeds the durable background owner from the persisted run row", async () => {
    const event = makeEvent();
    getRunOwnerEmailMock.mockResolvedValue("owner@example.com");

    const seeded = await seedBackgroundAgentRunOwnerContext(event, "run_123");

    expect(seeded).toEqual({
      owner: "owner@example.com",
      anonymous: false,
    });
    await expect(resolveAgentRunOwnerContext(event)).resolves.toBe(seeded);
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});
