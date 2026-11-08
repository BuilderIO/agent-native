import { createApp, defineEventHandler } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  override: undefined as boolean | undefined,
  identity: { user: { id: "new-user", createdAt: new Date() } },
  settings: new Map<string, Record<string, unknown>>(),
  track: vi.fn(),
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({
    onboarding: {
      builderSignupExperiment: mocks.enabled,
      builderSignupExperimentOverride: mocks.override,
    },
  }),
}));
vi.mock("./better-auth-instance.js", () => ({
  getAuthSecret: () => "test-only-signup-cookie-signing-secret",
  getBetterAuthInternalAdapter: async () => ({
    findUserByEmail: async () => mocks.identity,
  }),
}));
vi.mock("../settings/store.js", () => ({
  getSetting: async (key: string) => mocks.settings.get(key) ?? null,
  mutateSetting: async (
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    const result = update(mocks.settings.get(key) ?? null);
    mocks.settings.set(key, result);
    return result;
  },
  putSetting: async (key: string, value: Record<string, unknown>) => {
    mocks.settings.set(key, value);
  },
}));
vi.mock("../tracking/index.js", () => ({ track: mocks.track }));

import type { AuthSession } from "./auth.js";
import {
  BUILDER_SIGNUP_POLICY,
  bindBuilderSignupAttempt,
  getBuilderSignupConnectError,
  createBuilderSignupExperimentHandler,
  decodeBuilderSignupAssignment,
  encodeBuilderSignupAssignment,
} from "./builder-signup-experiment.js";

let testTime: number;
const ATTEMPT = "signup-attempt-example-123";
const accepted = () => ({
  id: "a".repeat(32),
  variant: "automatic" as const,
  issuedAt: testTime - 2000,
  acceptedAt: testTime - 1000,
  attemptId: ATTEMPT,
  policy: BUILDER_SIGNUP_POLICY,
});
const signedSession = (): AuthSession => ({
  email: "new@example.com",
  userId: "new-user",
  emailVerified: true,
  token: "test-session",
});
let session: AuthSession | null;
let sameOrigin: boolean;
let activate: ReturnType<typeof vi.fn>;
function request(body?: unknown, cookie?: string) {
  const app = createApp();
  app.use(
    "/experiment",
    createBuilderSignupExperimentHandler({
      getSession: async () => session,
      sameOrigin: () => sameOrigin,
      activate,
    }),
  );
  return app.fetch(
    new Request("https://design.example.com/experiment", {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie: `an_builder_signup=${cookie}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

function bindRequest(
  cookie: string,
  attemptId: string,
  method: "password" | "magic-link" | "google",
  email: string,
) {
  const app = createApp();
  app.use(
    "/bind",
    defineEventHandler(async (event) => ({
      bound: await bindBuilderSignupAttempt(event, attemptId, method, email),
    })),
  );
  return app.fetch(
    new Request("https://design.example.com/bind", {
      headers: { cookie: `an_builder_signup=${cookie}` },
    }),
  );
}

beforeEach(() => {
  testTime = Date.now();
  mocks.enabled = true;
  mocks.override = undefined;
  mocks.identity = { user: { id: "new-user", createdAt: new Date() } };
  mocks.settings.clear();
  mocks.settings.set("design_builder_signup_v1:consent:new-user", {
    ...accepted(),
    userId: "new-user",
    email: "new@example.com",
  });
  mocks.track.mockClear();
  session = null;
  sameOrigin = true;
  activate = vi.fn(async () => ({ ok: true }));
});

describe("pre-signup Builder experiment", () => {
  it("checks cookie-free eligibility without reserving or provisioning and skips completed activation", async () => {
    session = signedSession();
    expect(await (await request({ operation: "status" })).json()).toEqual({
      status: "eligible",
    });
    expect(activate).not.toHaveBeenCalled();
    expect(mocks.settings.has("design_builder_signup_v1:new-user")).toBe(false);
    expect(mocks.track).not.toHaveBeenCalled();
    mocks.settings.set("design_builder_signup_v1:new-user", {
      status: "fallback",
      code: "account_exists",
    });
    expect(await (await request({ operation: "status" })).json()).toEqual({
      status: "disabled",
      code: "already_completed",
    });
    expect(activate).not.toHaveBeenCalled();
    mocks.settings.set("design_builder_signup_v1:new-user", {
      status: "started",
      startedAt: testTime - 60000,
    });
    const uncertain = await request({ operation: "status" });
    expect(await uncertain.json()).toEqual({
      status: "disabled",
      code: "activation_in_progress",
    });
    expect(uncertain.headers.get("set-cookie")).toContain(
      "an_builder_signup_pending=",
    );
    expect(activate).not.toHaveBeenCalled();
    mocks.settings.clear();
    const skipped = await request({ operation: "status" });
    expect(skipped.headers.get("set-cookie")).toContain(
      "an_builder_signup_pending=",
    );
    expect(await skipped.json()).toEqual({
      status: "disabled",
      code: "not_enrolled",
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("recovers a consented Google signup without either browser cookie and provisions only once", async () => {
    mocks.settings.clear();
    const cookie = encodeBuilderSignupAssignment({
      ...accepted(),
      method: "google",
    });
    expect(
      await (
        await bindRequest(cookie, ATTEMPT, "google", "new@example.com")
      ).json(),
    ).toEqual({ bound: true });
    session = signedSession();
    expect(await (await request({ operation: "activate" })).json()).toEqual({
      status: "connected",
    });
    expect(await (await request({ operation: "activate" })).json()).toEqual({
      status: "connected",
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(
      "builder_signup_experiment_activation_started",
      expect.objectContaining({
        assignment_id: accepted().id,
        experiment_variant: "automatic",
      }),
      expect.objectContaining({ authUserId: "new-user" }),
    );
  });

  it.each([
    "wrong-user",
    "wrong-email",
    "wrong-policy",
    "control",
    "unaccepted",
  ])("never recovers invalid durable consent: %s", async (kind) => {
    session = signedSession();
    const consent = {
      ...accepted(),
      userId: "new-user",
      email: "new@example.com",
    };
    mocks.settings.set("design_builder_signup_v1:consent:new-user", {
      ...consent,
      ...(kind === "wrong-user" ? { userId: "other-user" } : {}),
      ...(kind === "wrong-email" ? { email: "other@example.com" } : {}),
      ...(kind === "wrong-policy" ? { policy: "unknown" } : {}),
      ...(kind === "control" ? { variant: "control" } : {}),
      ...(kind === "unaccepted" ? { acceptedAt: undefined } : {}),
    });
    const response = await request({ operation: "activate" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: "unavailable",
      code: "consent_invalid",
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it.each(["old", "invalid"])(
    "does not enroll a %s identity during signup binding",
    async (kind) => {
      mocks.settings.clear();
      mocks.identity.user.createdAt =
        kind === "old" ? new Date(testTime - 86400000) : new Date(Number.NaN);
      const result = await bindRequest(
        encodeBuilderSignupAssignment(accepted()),
        ATTEMPT,
        "password",
        "new@example.com",
      );
      expect(await result.json()).toEqual({ bound: false });
      expect(mocks.track).not.toHaveBeenCalled();
      expect(mocks.settings.size).toBe(0);
      expect(activate).not.toHaveBeenCalled();
    },
  );

  it("links signup enrollment without granting provisioning consent when acceptance is absent", async () => {
    mocks.settings.delete("design_builder_signup_v1:consent:new-user");
    const assignment = {
      id: "a".repeat(32),
      variant: "automatic" as const,
      issuedAt: testTime - 2000,
      policy: BUILDER_SIGNUP_POLICY,
    };
    const result = await bindRequest(
      encodeBuilderSignupAssignment(assignment),
      ATTEMPT,
      "password",
      "new@example.com",
    );
    expect(await result.json()).toEqual({ bound: false });
    expect(
      mocks.settings.has("design_builder_signup_v1:consent:new-user"),
    ).toBe(false);
    expect(mocks.track).toHaveBeenCalledWith(
      "builder_signup_experiment_enrolled",
      expect.objectContaining({
        assignment_id: assignment.id,
        experiment_variant: "automatic",
        method: "password",
      }),
      { authUserId: "new-user", userId: "new@example.com" },
    );
    expect(activate).not.toHaveBeenCalled();
  });

  it("reports an early unbound fallback with its assignment and authenticated identity", async () => {
    mocks.settings.delete("design_builder_signup_v1:consent:new-user");
    session = signedSession();
    await request(
      { operation: "activate" },
      encodeBuilderSignupAssignment(accepted()),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      "builder_signup_experiment_outcome",
      expect.objectContaining({
        assignment_id: "a".repeat(32),
        code: "signup_attempt_unbound",
        status: "fallback",
        replayed: false,
      }),
      { authUserId: "new-user", userId: "new@example.com" },
    );
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not invent an experiment arm when the assignment is missing", async () => {
    mocks.settings.clear();
    session = signedSession();
    // oracle-change: all signed-in users can check eligibility without creating an experiment outcome.
    expect(await (await request({ operation: "activate" })).json()).toEqual({
      status: "disabled",
      code: "not_enrolled",
    });
    expect(mocks.track).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("binds acceptance to the submitted email and auth attempt, not a later login", async () => {
    mocks.settings.delete("design_builder_signup_v1:consent:new-user");
    const acceptedResponse = await request(
      {
        operation: "accept",
        assignmentId: accepted().id,
        attemptId: ATTEMPT,
        method: "password",
        email: "new@example.com",
      },
      encodeBuilderSignupAssignment(accepted()),
    );
    const cookie = acceptedResponse.headers
      .get("set-cookie")
      ?.match(/an_builder_signup=([^;]+)/)?.[1];
    expect(cookie).toBeTruthy();
    if (!cookie) throw new Error("Acceptance cookie missing");
    mocks.identity.user.createdAt = new Date(Date.now());
    expect(
      await (
        await bindRequest(
          cookie,
          "another-signup-attempt",
          "password",
          "new@example.com",
        )
      ).json(),
    ).toEqual({ bound: false });
    expect(
      await (
        await bindRequest(cookie, ATTEMPT, "password", "other@example.com")
      ).json(),
    ).toEqual({ bound: false });
    expect(
      await (
        await bindRequest(cookie, ATTEMPT, "google", "new@example.com")
      ).json(),
    ).toEqual({ bound: false });
    expect(
      await (
        await bindRequest(cookie, ATTEMPT, "password", "new@example.com")
      ).json(),
    ).toEqual({ bound: true });
    expect(
      mocks.settings.get("design_builder_signup_v1:consent:new-user"),
    ).toMatchObject({
      attemptId: ATTEMPT,
      email: "new@example.com",
      userId: "new-user",
    });
  });

  it("records control assignment at account creation without recording Builder acceptance", async () => {
    mocks.settings.clear();
    const cookie = encodeBuilderSignupAssignment({
      id: accepted().id,
      variant: "control",
      issuedAt: testTime - 2000,
      policy: BUILDER_SIGNUP_POLICY,
    });
    await bindRequest(
      cookie,
      "unused-control-attempt",
      "google",
      "new@example.com",
    );
    const record = mocks.settings.get("design_builder_signup_v1:new-user");
    expect(record).toMatchObject({ variant: "control", status: "control" });
    expect(record).not.toHaveProperty("acceptedAt");
    expect(
      mocks.settings.has("design_builder_signup_v1:consent:new-user"),
    ).toBe(false);
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not record acceptance for control", async () => {
    const response = await request(
      { operation: "accept", assignmentId: accepted().id },
      encodeBuilderSignupAssignment({ ...accepted(), variant: "control" }),
    );
    expect(await response.json()).toEqual({ status: "not_required" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps existing-account fallback on the login/space-picker flow", async () => {
    mocks.settings.set("design_builder_signup_v1:new-user", {
      status: "fallback",
      code: "account_exists",
      message: "Connect the existing account",
      completedAt: testTime,
    });
    expect(await getBuilderSignupConnectError("new-user")).toEqual({
      code: "account_exists",
      message: "Connect the existing account",
      at: testTime,
    });
    expect(await getBuilderSignupConnectError("another-user")).toBeUndefined();
  });

  it("does not activate on a later original-browser login after cross-device magic completion failed to bind", async () => {
    mocks.settings.clear();
    const originalCookie = encodeBuilderSignupAssignment({
      ...accepted(),
      method: "magic-link",
      email: "new@example.com",
    });
    expect(
      await (
        await bindRequest("", ATTEMPT, "magic-link", "new@example.com")
      ).json(),
    ).toEqual({ bound: false });
    session = signedSession();
    expect(
      await (await request({ operation: "activate" }, originalCookie)).json(),
    ).toEqual({ status: "fallback", code: "signup_attempt_unbound" });
    expect(activate).not.toHaveBeenCalled();
  });

  it("keeps slow activation pending until its owner records the successful outcome", async () => {
    session = signedSession();
    let finish: (value: { ok: boolean }) => void = () => {
      throw new Error("Activation has not started");
    };
    activate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const cookie = encodeBuilderSignupAssignment(accepted());
    const first = request({ operation: "activate" }, cookie);
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    const key = "design_builder_signup_v1:new-user";
    const running = mocks.settings.get(key);
    if (!running) throw new Error("Reservation missing");
    mocks.settings.set(key, { ...running, startedAt: Date.now() - 60000 });
    expect(
      await (await request({ operation: "activate" }, cookie)).json(),
    ).toEqual({ status: "pending" });
    finish({ ok: true });
    expect(await (await first).json()).toEqual({ status: "connected" });
    expect(mocks.settings.get(key)?.status).toBe("connected");
  });

  it("honors a deployment override even when the app opts in", async () => {
    mocks.override = false;
    expect(await (await request()).json()).toEqual({ status: "disabled" });
  });

  it("requires consent bound to the signup that created the verified identity", async () => {
    mocks.settings.delete("design_builder_signup_v1:consent:new-user");
    session = signedSession();
    const result = await request(
      { operation: "activate" },
      encodeBuilderSignupAssignment(accepted()),
    );
    expect(await result.json()).toEqual({
      status: "fallback",
      code: "signup_attempt_unbound",
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not retry an uncertain in-flight attempt", async () => {
    session = signedSession();
    mocks.settings.set("design_builder_signup_v1:new-user", {
      status: "started",
      startedAt: Date.now() - 60000,
      attempt: "stopped",
    });
    const result = await request(
      { operation: "activate" },
      encodeBuilderSignupAssignment(accepted()),
    );
    expect(await result.json()).toEqual({ status: "pending" });
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(activate).not.toHaveBeenCalled();
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user")?.status,
    ).toBe("started");
  });

  it("records a thrown activation as a terminal failure", async () => {
    session = signedSession();
    activate.mockRejectedValue(new Error("authorization store unavailable"));
    const result = await request(
      { operation: "activate" },
      encodeBuilderSignupAssignment(accepted()),
    );
    expect((await result.json()).status).toBe("fallback");
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user"),
    ).toMatchObject({ status: "fallback", code: "activation_interrupted" });
  });

  it("does not assign or write cookies when disabled", async () => {
    mocks.enabled = false;
    const response = await request();
    expect(await response.json()).toEqual({ status: "disabled" });
    expect(response.headers.get("set-cookie")).toBeNull();
    const staleHint = await request(
      { operation: "status" },
      "unused; an_builder_signup_pending=1",
    );
    expect(await staleHint.json()).toEqual({ status: "disabled" });
    expect(staleHint.headers.get("set-cookie")).toContain(
      "an_builder_signup_pending=",
    );
  });
  it("assigns anonymously and keeps the same arm across requests", async () => {
    const response = await request();
    const first = await response.json();
    expect(first.status).toBe("assigned");
    const cookie = response.headers
      .get("set-cookie")
      ?.match(/an_builder_signup=([^;]+)/)?.[1];
    expect(cookie).toBeTruthy();
    expect(await (await request(undefined, cookie)).json()).toEqual(first);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects tampered, expired and future cookies", () => {
    const valid = encodeBuilderSignupAssignment(accepted());
    expect(decodeBuilderSignupAssignment(valid)?.variant).toBe("automatic");
    expect(decodeBuilderSignupAssignment(`${valid}tampered`)).toBeNull();
    expect(decodeBuilderSignupAssignment(`${valid}.extra`)).toBeNull();
    expect(
      decodeBuilderSignupAssignment(
        encodeBuilderSignupAssignment({
          ...accepted(),
          issuedAt: Date.now() - 8 * 86400000,
        }),
      ),
    ).toBeNull();
    expect(
      decodeBuilderSignupAssignment(
        encodeBuilderSignupAssignment({
          ...accepted(),
          issuedAt: Date.now() + 10000,
        }),
      ),
    ).toBeNull();
  });
  it("records acceptance only for the displayed assignment before authentication", async () => {
    const assignment = accepted();
    const cookie = encodeBuilderSignupAssignment(assignment);
    expect(
      (await request({ operation: "accept", assignmentId: "wrong" }, cookie))
        .status,
    ).toBe(409);
    const response = await request(
      {
        operation: "accept",
        assignmentId: assignment.id,
        attemptId: ATTEMPT,
        method: "google",
      },
      cookie,
    );
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    session = signedSession();
    expect(
      (
        await request(
          {
            operation: "accept",
            assignmentId: assignment.id,
            attemptId: ATTEMPT,
            method: "google",
          },
          cookie,
        )
      ).status,
    ).toBe(409);
  });
  it("rejects cross-origin acceptance and activation", async () => {
    sameOrigin = false;
    expect(
      (
        await request(
          { operation: "accept" },
          encodeBuilderSignupAssignment(accepted()),
        )
      ).status,
    ).toBe(403);
    expect(activate).not.toHaveBeenCalled();
  });
  it("requires verified identity, valid consent and a newly created account", async () => {
    const cookie = encodeBuilderSignupAssignment(accepted());
    session = { ...signedSession(), emailVerified: false };
    expect((await request({ operation: "activate" }, cookie)).status).toBe(401);
    session = signedSession();
    mocks.identity.user.createdAt = new Date(Date.now() - 86400000);
    expect(
      await (await request({ operation: "activate" }, cookie)).json(),
    ).toEqual({ status: "fallback", code: "identity_ineligible" });
    expect(activate).not.toHaveBeenCalled();
  });
  it("never provisions control accounts", async () => {
    mocks.settings.clear();
    session = signedSession();
    const cookie = encodeBuilderSignupAssignment({
      ...accepted(),
      variant: "control",
    });
    expect(
      (await (await request({ operation: "activate" }, cookie)).json()).status,
    ).toBe("fallback");
    expect(activate).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(
      "builder_signup_experiment_outcome",
      expect.objectContaining({
        code: "control",
        experiment_variant: "control",
      }),
      expect.objectContaining({ authUserId: "new-user" }),
    );
  });
  it("activates once and persists the acceptance and outcome", async () => {
    session = signedSession();
    const cookie = encodeBuilderSignupAssignment(accepted());
    expect(
      (await (await request({ operation: "activate" }, cookie)).json()).status,
    ).toBe("connected");
    expect(
      (await (await request({ operation: "activate" }, cookie)).json()).status,
    ).toBe("connected");
    expect(activate).toHaveBeenCalledTimes(1);
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user"),
    ).toMatchObject({
      policy: BUILDER_SIGNUP_POLICY,
      status: "connected",
      userId: "new-user",
    });
  });
  it("reports an in-flight activation as pending and does not start a second one", async () => {
    session = signedSession();
    let finish: (value: { ok: boolean }) => void = () => {
      throw new Error("Activation has not started");
    };
    activate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const cookie = encodeBuilderSignupAssignment(accepted());
    const first = request({ operation: "activate" }, cookie);
    await vi.waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    const concurrent = await request({ operation: "activate" }, cookie);
    expect(await concurrent.json()).toEqual({ status: "pending" });
    expect(concurrent.headers.get("set-cookie")).toBeNull();
    finish({ ok: true });
    expect((await (await first).json()).status).toBe("connected");
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("does not provision when the account creation time is unreadable", async () => {
    session = signedSession();
    mocks.identity.user.createdAt = new Date(Number.NaN);
    expect(
      (
        await (
          await request(
            { operation: "activate" },
            encodeBuilderSignupAssignment(accepted()),
          )
        ).json()
      ).status,
    ).toBe("fallback");
    expect(activate).not.toHaveBeenCalled();
  });

  it("uses the ordinary connection flow when the safe API is unavailable, without retrying", async () => {
    session = signedSession();
    activate.mockResolvedValue({ ok: false, code: "unsupported_version" });
    const cookie = encodeBuilderSignupAssignment(accepted());
    expect(
      (await (await request({ operation: "activate" }, cookie)).json()).status,
    ).toBe("fallback");
    await request({ operation: "activate" }, cookie);
    expect(activate).toHaveBeenCalledTimes(1);
  });
});
