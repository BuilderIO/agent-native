import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.hoisted(() => vi.fn());
const appStateGetMock = vi.hoisted(() => vi.fn());
const appStatePutMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());
const updateUserOnboardingRoleMock = vi.hoisted(() => vi.fn());
const getUserProfileMock = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

vi.mock("../server/auth.js", () => ({
  cookieDomainAttrs: () => {
    const domain = process.env.COOKIE_DOMAIN;
    return domain ? { domain } : {};
  },
  isHttpsRequest: () => true,
  sharedFirstPartyCookieDomainAttrs: () => {
    const domain = process.env.COOKIE_DOMAIN;
    return domain ? { domain } : {};
  },
  crossSiteCookieAttrs: () => ({
    sameSite: "none",
    secure: true,
    partitioned: true,
  }),
  getSession: (...args: any[]) => getSessionMock(...args),
}));

vi.mock("../application-state/store.js", () => ({
  appStateGet: (...args: any[]) => appStateGetMock(...args),
  appStatePut: (...args: any[]) => appStatePutMock(...args),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: (...args: any[]) => getOrgContextMock(...args),
}));

vi.mock("../user-profile/store.js", () => ({
  getUserProfile: (...args: any[]) => getUserProfileMock(...args),
  updateUserOnboardingRole: (...args: any[]) =>
    updateUserOnboardingRoleMock(...args),
}));

vi.mock("../tracking/index.js", () => ({
  classifyTrackingFailure: () => "error",
  track: (...args: any[]) => trackMock(...args),
}));

import { CredentialStoreUnavailableError } from "../server/credential-provider.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  FIRST_RUN_ONBOARDING_COMPLETED_KEY,
  FIRST_RUN_ONBOARDING_COOKIE,
  FIRST_RUN_ONBOARDING_ELIGIBLE_KEY,
} from "../shared/first-run-onboarding.js";
import { createOnboardingPlugin } from "./plugin.js";
import {
  __resetOnboardingRegistry,
  registerOnboardingStep,
} from "./registry.js";
import {
  SHARED_ONBOARDING_COOKIE,
  decodeSharedOnboardingCookie,
  encodeSharedOnboardingCookie,
  hashOnboardingEmail,
} from "./shared-cookie.js";

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(
  nitroApp: any,
  pathname: string,
  method = "GET",
  headers: HeadersInit = {},
  requestBody?: unknown,
) {
  const url = `https://app.test${pathname}`;
  const event = {
    method,
    url: new URL(url),
    path: pathname,
    context: {},
    req: new Request(url, {
      method,
      headers,
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    }),
    res: {
      status: 200,
      headers: new Headers(),
    },
    node: {
      req: {
        method,
        url: pathname,
        headers: {
          host: "app.test",
          "x-forwarded-proto": "https",
        },
      },
      res: {
        statusCode: 200,
        setHeader() {},
      },
    },
  };
  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };
  const responseBody = await next();
  return {
    body: responseBody,
    status: event.res.status,
    headers: event.res.headers,
  };
}

function registerRequestContextProbeStep() {
  registerOnboardingStep({
    id: "llm",
    order: 10,
    required: true,
    title: "Connect an AI engine",
    description: "Request-scoped credentials should be visible here.",
    methods: [],
    isComplete: () =>
      getRequestUserEmail() === "alice@example.com" &&
      getRequestOrgId() === "org-1",
  });
}

describe("onboarding plugin routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    __resetOnboardingRegistry();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: "org-1",
    });
    getOrgContextMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: "org-1",
      orgName: "Alice's workspace",
      role: "owner",
    });
    appStateGetMock.mockResolvedValue(null);
    appStatePutMock.mockResolvedValue(undefined);
    updateUserOnboardingRoleMock.mockResolvedValue("developer");
    getUserProfileMock.mockResolvedValue({
      email: "alice@example.com",
      name: "Alice",
      onboardingRole: null,
    });
    trackMock.mockReset();
  });

  it("runs step completion resolvers inside the authenticated request context", async () => {
    registerRequestContextProbeStep();
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(nitroApp, "/_agent-native/onboarding/steps");

    expect(result.status).toBe(200);
    expect(result.body).toEqual([
      expect.objectContaining({
        id: "llm",
        complete: true,
      }),
    ]);
  });

  it("omits unavailable steps without running their completion resolver", async () => {
    const isComplete = vi.fn(() => true);
    registerOnboardingStep({
      id: "google",
      order: 10,
      title: "Connect Google",
      description: "Requires managed Google OAuth.",
      methods: [],
      isAvailable: () => false,
      isComplete,
    });
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(nitroApp, "/_agent-native/onboarding/steps");

    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
    expect(isComplete).not.toHaveBeenCalled();
  });

  it("propagates availability failures so callers can retry", async () => {
    registerOnboardingStep({
      id: "google",
      order: 10,
      title: "Connect Google",
      description: "Requires managed Google OAuth.",
      methods: [],
      isAvailable: () => {
        throw new Error("credential store unavailable");
      },
      isComplete: () => false,
    });
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(nitroApp, "/_agent-native/onboarding/steps");

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "credential store unavailable" });
  });

  it("uses the same request context when reporting dismissed/allComplete state", async () => {
    registerRequestContextProbeStep();
    appStateGetMock.mockImplementation(async (_sessionId, key) =>
      key === "onboarding:dismissed" ? { dismissed: true } : null,
    );
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/dismissed",
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      dismissed: true,
      allComplete: true,
    });
    expect(appStateGetMock).toHaveBeenCalledWith(
      "alice@example.com",
      "onboarding:dismissed",
    );
  });

  it("propagates availability failures from the dismissed state route", async () => {
    registerOnboardingStep({
      id: "google",
      order: 10,
      title: "Connect Google",
      description: "Requires managed Google OAuth.",
      methods: [],
      isAvailable: () => {
        throw new CredentialStoreUnavailableError();
      },
      isComplete: () => false,
    });
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/dismissed",
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error:
        "Could not read your saved connections — the app database did not answer. This is temporary; try again in a moment.",
    });
  });

  it("composes steps, dismissed state, and profile in one summary read", async () => {
    registerRequestContextProbeStep();
    appStateGetMock.mockImplementation(async (_sessionId, key) =>
      key === "onboarding:dismissed" ? { dismissed: true } : null,
    );
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/summary",
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      steps: [expect.objectContaining({ id: "llm", complete: true })],
      dismissed: true,
      profile: expect.objectContaining({ appId: expect.any(String) }),
    });
    expect(appStateGetMock).toHaveBeenCalledWith(
      "alice@example.com",
      "onboarding:dismissed",
    );
  });

  it("keeps the summary usable when the optional dismissed read throws", async () => {
    registerRequestContextProbeStep();
    appStateGetMock.mockImplementation(async (_sessionId, key) => {
      if (key === "onboarding:dismissed") {
        throw new Error("connection timed out");
      }
      return null;
    });
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/summary",
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      steps: [expect.objectContaining({ id: "llm", complete: true })],
      dismissed: false,
      profile: expect.objectContaining({ appId: expect.any(String) }),
    });
  });

  it("still fails the summary when the credential store is unavailable", async () => {
    registerRequestContextProbeStep();
    appStateGetMock.mockRejectedValue(new CredentialStoreUnavailableError());
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/summary",
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error:
        "Could not read your saved connections — the app database did not answer. This is temporary; try again in a moment.",
    });
  });

  it("keeps first-run onboarding tied to the signup cookie and completion state", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    appStateGetMock.mockImplementation(async (_sessionId, key) =>
      key === FIRST_RUN_ONBOARDING_ELIGIBLE_KEY ? { orgId: "org-1" } : null,
    );

    const pending = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/status",
      "GET",
      { cookie: `${FIRST_RUN_ONBOARDING_COOKIE}=1` },
    );
    expect(pending.body).toEqual({ firstRun: true });

    appStateGetMock.mockImplementation(async (_sessionId, key) =>
      key === FIRST_RUN_ONBOARDING_COMPLETED_KEY ? { completed: true } : null,
    );
    const completed = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/status",
      "GET",
      { cookie: `${FIRST_RUN_ONBOARDING_COOKIE}=1` },
    );
    expect(completed.body).toEqual({ firstRun: false });

    appStateGetMock.mockResolvedValue(null);
    const finish = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/complete",
      "POST",
      {
        cookie: `${FIRST_RUN_ONBOARDING_COOKIE}=1`,
        "content-type": "application/json",
      },
    );
    expect(finish.body).toEqual({ ok: true });
    expect(appStatePutMock).toHaveBeenCalledWith(
      "alice@example.com",
      FIRST_RUN_ONBOARDING_COMPLETED_KEY,
      { completed: true, at: expect.any(String) },
      { requestSource: "agent" },
    );
    expect(finish.headers.get("set-cookie")).toContain(
      `${FIRST_RUN_ONBOARDING_COOKIE}=`,
    );
    expect(finish.headers.get("set-cookie")).toContain("Domain=.example.com");
    expect(finish.headers.get("set-cookie")).toContain("SameSite=None");
    expect(finish.headers.get("set-cookie")).toContain("Secure");
    expect(finish.headers.get("set-cookie")).toContain("Partitioned");
  });

  it("sets an unpartitioned shared completion cookie when enabled", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    vi.stubEnv("ONBOARDING_SHARED_COMPLETION", "1");
    getUserProfileMock.mockResolvedValue({
      email: "alice@example.com",
      name: "Alice",
      onboardingRole: "design",
    });
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/complete",
      "POST",
      { "content-type": "application/json" },
    );

    expect(result.body).toEqual({ ok: true });
    const setCookie = result.headers.get("set-cookie") ?? "";
    const sharedCookie = setCookie
      .split(", ")
      .find((cookie) => cookie.startsWith(`${SHARED_ONBOARDING_COOKIE}=`));
    const value = sharedCookie?.split(";")[0]?.split("=")[1];
    expect(decodeSharedOnboardingCookie(value)).toEqual({
      role: "design",
      emailHash: hashOnboardingEmail("alice@example.com"),
    });
    expect(sharedCookie).toContain("Domain=.example.com");
    expect(sharedCookie).toContain("SameSite=Lax");
    expect(sharedCookie).toContain("HttpOnly");
    expect(sharedCookie).toContain("Secure");
    expect(sharedCookie).not.toContain("Partitioned");
  });

  it("adopts a matching shared completion and role once", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    vi.stubEnv("ONBOARDING_SHARED_COMPLETION", "1");
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);
    appStateGetMock.mockImplementation(async (_sessionId, key) =>
      key === FIRST_RUN_ONBOARDING_ELIGIBLE_KEY ? { orgId: "org-1" } : null,
    );

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/status",
      "GET",
      {
        cookie: [
          `${FIRST_RUN_ONBOARDING_COOKIE}=1`,
          `${SHARED_ONBOARDING_COOKIE}=${encodeSharedOnboardingCookie({ role: "design", email: "alice@example.com" })}`,
        ].join("; "),
      },
    );

    expect(result.body).toEqual({ firstRun: false });
    expect(appStatePutMock).toHaveBeenCalledWith(
      "alice@example.com",
      FIRST_RUN_ONBOARDING_COMPLETED_KEY,
      {
        completed: true,
        at: expect.any(String),
        source: "shared-cookie",
      },
      { requestSource: "agent" },
    );
    expect(updateUserOnboardingRoleMock).toHaveBeenCalledWith(
      "alice@example.com",
      "design",
    );
    expect(trackMock).toHaveBeenCalledWith(
      "onboarding_first_run_adopted",
      { flow: "first_run", source: "shared_cookie", role: "design" },
      { userId: "alice@example.com" },
    );
    expect(result.headers.get("set-cookie")).toContain(
      `${FIRST_RUN_ONBOARDING_COOKIE}=`,
    );

    appStatePutMock.mockClear();
    updateUserOnboardingRoleMock.mockClear();
    appStateGetMock.mockResolvedValue({ completed: true });
    const second = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/status",
      "GET",
      {
        cookie: [
          `${FIRST_RUN_ONBOARDING_COOKIE}=1`,
          `${SHARED_ONBOARDING_COOKIE}=malformed`,
        ].join("; "),
      },
    );
    expect(second.body).toEqual({ firstRun: false });
    expect(appStatePutMock).not.toHaveBeenCalled();
    expect(updateUserOnboardingRoleMock).not.toHaveBeenCalled();
  });

  it("does not adopt a shared cookie for another email or overwrite a local role", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    vi.stubEnv("ONBOARDING_SHARED_COMPLETION", "1");
    getUserProfileMock.mockResolvedValue({
      email: "alice@example.com",
      name: "Alice",
      onboardingRole: "developer",
    });
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);
    appStateGetMock.mockImplementation(async (_sessionId, key) =>
      key === FIRST_RUN_ONBOARDING_ELIGIBLE_KEY ? { orgId: "org-1" } : null,
    );

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/status",
      "GET",
      {
        cookie: [
          `${FIRST_RUN_ONBOARDING_COOKIE}=1`,
          `${SHARED_ONBOARDING_COOKIE}=${encodeSharedOnboardingCookie({ role: "design", email: "other@example.com" })}`,
        ].join("; "),
      },
    );

    expect(result.body).toEqual({ firstRun: true });
    expect(appStatePutMock).not.toHaveBeenCalled();
    expect(updateUserOnboardingRoleMock).not.toHaveBeenCalled();
  });

  it("does not adopt a shared cookie for a member who is not eligible for first run", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    vi.stubEnv("ONBOARDING_SHARED_COMPLETION", "1");
    getOrgContextMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: "org-existing",
      orgName: "Existing workspace",
      role: "member",
    });
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/status",
      "GET",
      {
        cookie: [
          `${FIRST_RUN_ONBOARDING_COOKIE}=1`,
          `${SHARED_ONBOARDING_COOKIE}=${encodeSharedOnboardingCookie({ role: "design", email: "alice@example.com" })}`,
        ].join("; "),
      },
    );

    expect(result.body).toEqual({ firstRun: false });
    expect(appStatePutMock).not.toHaveBeenCalled();
    expect(updateUserOnboardingRoleMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("does not mark completion when importing the shared role fails", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    vi.stubEnv("ONBOARDING_SHARED_COMPLETION", "1");
    updateUserOnboardingRoleMock.mockRejectedValue(new Error("db down"));
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);
    appStateGetMock.mockImplementation(async (_sessionId, key) =>
      key === FIRST_RUN_ONBOARDING_ELIGIBLE_KEY ? { orgId: "org-1" } : null,
    );

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/status",
      "GET",
      {
        cookie: [
          `${FIRST_RUN_ONBOARDING_COOKIE}=1`,
          `${SHARED_ONBOARDING_COOKIE}=${encodeSharedOnboardingCookie({ role: "design", email: "alice@example.com" })}`,
        ].join("; "),
      },
    );

    expect(result.status).toBe(500);
    expect(appStatePutMock).not.toHaveBeenCalled();
  });

  it("still shares completion without a role when the profile read fails", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    vi.stubEnv("ONBOARDING_SHARED_COMPLETION", "1");
    getUserProfileMock.mockRejectedValue(new Error("db down"));
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/complete",
      "POST",
      { "content-type": "application/json" },
    );

    expect(result.body).toEqual({ ok: true });
    const sharedCookie = (result.headers.get("set-cookie") ?? "")
      .split(", ")
      .find((cookie) => cookie.startsWith(`${SHARED_ONBOARDING_COOKIE}=`));
    const value = sharedCookie?.split(";")[0]?.split("=")[1];
    expect(decodeSharedOnboardingCookie(value)).toEqual({
      role: null,
      emailHash: hashOnboardingEmail("alice@example.com"),
    });
  });

  it("warns and stays off when enabled without a parent cookie domain", async () => {
    vi.stubEnv("COOKIE_DOMAIN", "");
    vi.stubEnv("ONBOARDING_SHARED_COMPLETION", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/complete",
      "POST",
      { "content-type": "application/json" },
    );

    expect(result.body).toEqual({ ok: true });
    expect(result.headers.get("set-cookie") ?? "").not.toContain(
      `${SHARED_ONBOARDING_COOKIE}=`,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("COOKIE_DOMAIN is not set"),
    );
    warn.mockRestore();
  });

  it("does not read or write the shared cookie when disabled", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/complete",
      "POST",
      { "content-type": "application/json" },
    );

    expect(result.body).toEqual({ ok: true });
    expect(result.headers.get("set-cookie")).not.toContain(
      `${SHARED_ONBOARDING_COOKIE}=`,
    );
  });

  it("does not show first-run onboarding to a member of an existing organization", async () => {
    vi.stubEnv("COOKIE_DOMAIN", ".example.com");
    getOrgContextMock.mockResolvedValue({
      email: "alice@example.com",
      orgId: "org-existing",
      orgName: "Existing organization",
      role: "member",
    });
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/status",
      "GET",
      { cookie: `${FIRST_RUN_ONBOARDING_COOKIE}=1` },
    );

    expect(result.body).toEqual({ firstRun: false });
    expect(getOrgContextMock).toHaveBeenCalledOnce();
    expect(result.headers.get("set-cookie")).toContain(
      `${FIRST_RUN_ONBOARDING_COOKIE}=`,
    );
    expect(result.headers.get("set-cookie")).toContain("Domain=.example.com");
  });

  it("requires an authenticated user to complete first-run onboarding", async () => {
    getSessionMock.mockResolvedValue(null);
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/complete",
      "POST",
      { "content-type": "application/json" },
    );

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Authentication required" });
    expect(appStatePutMock).not.toHaveBeenCalled();
  });

  it("saves and tracks an authenticated user's onboarding role", async () => {
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/role",
      "POST",
      {
        "content-type": "application/json",
        "x-agent-native-session-id": "session-role-save",
      },
      { role: "developer" },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, role: "developer" });
    expect(updateUserOnboardingRoleMock).toHaveBeenCalledWith(
      "alice@example.com",
      "developer",
    );
    expect(trackMock).toHaveBeenCalledWith(
      "onboarding.role_selected",
      {
        flow: "first_run",
        step_id: "role",
        role: "developer",
        outcome: "success",
      },
      { userId: "alice@example.com", sessionId: "session-role-save" },
    );
  });

  it("omits unsafe browser session ids from role telemetry", async () => {
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/role",
      "POST",
      {
        "content-type": "application/json",
        "x-agent-native-session-id": "unsafe session id",
      },
      { role: "developer" },
    );

    expect(result.status).toBe(200);
    expect(trackMock).toHaveBeenCalledWith(
      "onboarding.role_selected",
      expect.objectContaining({ outcome: "success" }),
      { userId: "alice@example.com" },
    );
  });

  it("tracks a bounded category when the role save fails", async () => {
    const failure = new Error("provider details stay out of analytics");
    updateUserOnboardingRoleMock.mockRejectedValueOnce(failure);
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/role",
      "POST",
      {
        "content-type": "application/json",
        "x-agent-native-session-id": "session-role-save",
      },
      { role: "developer" },
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: failure.message });

    expect(trackMock).toHaveBeenCalledWith(
      "onboarding_role_save_failed",
      {
        flow: "first_run",
        step_id: "role",
        role: "developer",
        failure_type: "error",
      },
      { userId: "alice@example.com", sessionId: "session-role-save" },
    );
  });

  it("saves custom onboarding roles while categorizing telemetry as other", async () => {
    updateUserOnboardingRoleMock.mockResolvedValueOnce("Content strategist");
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/role",
      "POST",
      {
        "content-type": "application/json",
        "x-agent-native-session-id": "session-custom-role",
      },
      { role: "Content strategist" },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, role: "Content strategist" });
    expect(updateUserOnboardingRoleMock).toHaveBeenCalledWith(
      "alice@example.com",
      "Content strategist",
    );
    expect(trackMock).toHaveBeenCalledWith(
      "onboarding.role_selected",
      {
        flow: "first_run",
        step_id: "role",
        role: "other",
        outcome: "success",
      },
      { userId: "alice@example.com", sessionId: "session-custom-role" },
    );
  });

  it("rejects empty onboarding roles before writing or tracking", async () => {
    const nitroApp = createNitroApp();
    await createOnboardingPlugin({ skipDefaultSteps: true })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/onboarding/first-run/role",
      "POST",
      { "content-type": "application/json" },
      { role: "" },
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Invalid onboarding role" });
    expect(updateUserOnboardingRoleMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });
});
