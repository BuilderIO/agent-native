import { createApp, defineEventHandler } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appId: "agent-native-clips" as string | undefined,
  enabled: true,
  hostedHosts: [] as string[],
  automaticPercent: 50,
  assignmentRoll: 0,
  experimentId: "design_builder_signup_v1",
  failTerminalWrites: 0,
  waitUntil: undefined as ((work: Promise<unknown>) => void) | undefined,
  override: undefined as boolean | undefined,
  identity: { user: { id: "new-user", createdAt: new Date() } },
  settings: new Map<string, Record<string, unknown>>(),
  track: vi.fn(),
  magicLinkTokenHook: undefined as
    | ((email: string, token: string) => Promise<void> | void)
    | undefined,
}));
vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomInt: () => mocks.assignmentRoll,
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({
    app: { id: mocks.appId, slug: "clips" },
    onboarding: {
      builderSignupExperiment: mocks.enabled,
      builderSignupHostedHosts: mocks.hostedHosts,
      builderSignupAutomaticPercent: mocks.automaticPercent,
      builderSignupExperimentId: mocks.experimentId,
      builderSignupExperimentOverride: mocks.override,
    },
  }),
}));
vi.mock("./better-auth-instance.js", () => ({
  getAuthSecret: () => "test-only-signup-cookie-signing-secret",
  getBetterAuthInternalAdapter: async () => ({
    findUserByEmail: async () => mocks.identity,
  }),
  runWithMagicLinkIssuedTokenHook: async <T>(
    hook: (email: string, token: string) => Promise<void> | void,
    run: () => Promise<T>,
  ): Promise<T> => {
    mocks.magicLinkTokenHook = hook;
    try {
      return await run();
    } finally {
      mocks.magicLinkTokenHook = undefined;
    }
  },
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
    if (
      (result.status === "connected" || result.status === "fallback") &&
      mocks.failTerminalWrites-- > 0
    )
      throw new Error("Temporary terminal write failure");
    mocks.settings.set(key, result);
    return result;
  },
  putSetting: async (key: string, value: Record<string, unknown>) => {
    mocks.settings.set(key, value);
  },
}));
vi.mock("../tracking/index.js", () => ({
  track: mocks.track,
  flushTracking: vi.fn(async () => []),
}));
vi.mock("./background-work.js", () => ({
  platformWaitUntil: () => mocks.waitUntil,
}));

import type { AuthSession } from "./auth.js";
import {
  BUILDER_SIGNUP_POLICY,
  bindBuilderSignupAttempt,
  confirmMagicLinkLandingBuilderSignup,
  consumeDeferredGoogleSignupReceipt,
  getBuilderSignupConnectError,
  getBuilderSignupTrackingIdentity,
  createBuilderSignupExperiment,
  prepareMagicLinkLandingBuilderSignup,
  recordDeferredGoogleSignupReceipt,
  setBuilderSignupVerifiedStarter,
  startBuilderSignupForVerifiedSession,
  withMagicLinkBuilderSignupRecorder,
  builderSignupAssignmentCookieName,
  builderSignupClientFailureExperimentId,
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
  method: "google" as const,
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
let reconcile: ReturnType<typeof vi.fn>;
function request(
  body?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) {
  const app = createApp();
  app.use(
    "/experiment",
    createBuilderSignupExperiment({
      getSession: async () => session,
      sameOrigin: () => sameOrigin,
      activate,
      reconcile,
    }).handler,
  );
  return app.fetch(
    new Request("https://design.example.com/experiment", {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        ...headers,
        ...(cookie
          ? { cookie: `${builderSignupAssignmentCookieName()}=${cookie}` }
          : {}),
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
      bound: Boolean(
        await bindBuilderSignupAttempt(event, attemptId, method, email),
      ),
    })),
  );
  return app.fetch(
    new Request("https://design.example.com/bind", {
      headers: { cookie: `${builderSignupAssignmentCookieName()}=${cookie}` },
    }),
  );
}

beforeEach(() => {
  testTime = Date.now();
  mocks.appId = "agent-native-clips";
  mocks.enabled = true;
  mocks.hostedHosts = [];
  mocks.automaticPercent = 50;
  mocks.assignmentRoll = 0;
  mocks.experimentId = "design_builder_signup_v1";
  mocks.failTerminalWrites = 0;
  mocks.waitUntil = undefined;
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
  reconcile = vi.fn(async () => false);
});

describe("pre-signup Builder experiment", () => {
  it.each([
    [49, "automatic"],
    [50, "control"],
  ])(
    "assigns a roll of %s to %s at the default allocation",
    async (roll, variant) => {
      mocks.assignmentRoll = roll;
      expect(await (await request()).json()).toMatchObject({ variant });
    },
  );

  it("assigns new Clips visitors to automatic and graduates existing control assignments", async () => {
    mocks.experimentId = "clips_builder_signup_v1";
    mocks.automaticPercent = 100;
    mocks.assignmentRoll = 99;

    expect(await (await request()).json()).toMatchObject({
      experimentId: "clips_builder_signup_v1",
      variant: "automatic",
    });

    const control = {
      id: "b".repeat(32),
      variant: "control" as const,
      issuedAt: testTime,
      policy: BUILDER_SIGNUP_POLICY,
    };
    const response = await request(
      undefined,
      encodeBuilderSignupAssignment(control),
    );
    const graduated = await response.json();
    expect(graduated).toMatchObject({
      experimentId: "clips_builder_signup_v1",
      variant: "automatic",
    });
    expect(graduated.id).not.toBe(control.id);
  });

  it("keeps assignment cookie names independent across same-origin apps", async () => {
    const names = new Set<string>();
    for (const app of ["design", "clips", "slides"]) {
      mocks.experimentId = `${app}_builder_signup_v1`;
      const response = await request();
      const name = response.headers.getSetCookie()[0]?.split("=")[0];
      expect(name).toBeTruthy();
      if (!name) throw new Error("Assignment cookie missing");
      names.add(name);
    }
    expect(names.size).toBe(3);
    expect(names.has("an_builder_signup")).toBe(true);
  });

  it.each(["clips", "slides"])(
    "isolates %s assignments and consent from Design",
    async (app) => {
      const designCookie = encodeBuilderSignupAssignment(accepted());
      mocks.experimentId = `${app}_builder_signup_v1`;
      const assignment = await (await request(undefined, designCookie)).json();
      expect(assignment.experimentId).toBe(`${app}_builder_signup_v1`);
      expect(assignment.acceptedAt).toBeUndefined();
      session = signedSession();
      const response = await (
        await request({ operation: "start" }, designCookie)
      ).json();
      expect(response.status).not.toBe("pending");
      expect(activate).not.toHaveBeenCalled();
      mocks.settings.set(`${app}_builder_signup_v1:consent:new-user`, {
        ...accepted(),
        userId: "new-user",
        email: "new@example.com",
      });
      const appCookie = encodeBuilderSignupAssignment(accepted());
      const activated = await (
        await request({ operation: "activate" }, appCookie)
      ).json();
      expect(activated.status).toBe("connected");
      expect(
        mocks.settings.get(`${app}_builder_signup_v1:new-user`)?.status,
      ).toBe("connected");
      expect(mocks.track).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ experiment_id: `${app}_builder_signup_v1` }),
        expect.anything(),
      );
    },
  );

  it.each([true, false])(
    "finishes a verified signup callback without a subsequent app request (background=%s)",
    async (background) => {
      const works: Promise<unknown>[] = [];
      if (background)
        mocks.waitUntil = (work) => {
          works.push(work);
        };
      let finish!: (result: { ok: boolean }) => void;
      activate.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const experiment = createBuilderSignupExperiment({
        getSession: async () => null,
        sameOrigin: () => false,
        activate,
        reconcile,
      });
      setBuilderSignupVerifiedStarter(experiment.startVerifiedSignup);
      const server = createApp();
      server.use(
        "/callback",
        defineEventHandler(async (event) => {
          await startBuilderSignupForVerifiedSession(event, signedSession());
          return { signedIn: true };
        }),
      );
      const response = server.fetch(
        new Request("https://design.example.com/callback"),
      );
      await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce());
      if (background)
        expect(await (await response).json()).toEqual({ signedIn: true });
      expect(
        mocks.settings.get("design_builder_signup_v1:new-user")?.status,
      ).toBe("started");
      // No frontend hydration, session read, start request, or polling happens.
      finish({ ok: true });
      await response;
      await Promise.all(works);
      expect(
        mocks.settings.get("design_builder_signup_v1:new-user")?.status,
      ).toBe("connected");
      session = signedSession();
      await request({ operation: "start" });
      expect(activate).toHaveBeenCalledOnce();
    },
  );

  it("starts provisioning on the first request and finishes after the browser stops polling", async () => {
    session = signedSession();
    let finish!: (result: { ok: boolean }) => void;
    activate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const background: Promise<unknown>[] = [];
    mocks.waitUntil = (work) => {
      background.push(work);
    };
    expect(await (await request({ operation: "start" })).json()).toEqual({
      status: "pending",
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(await (await request({ operation: "start" })).json()).toEqual({
      status: "pending",
    });
    expect(activate).toHaveBeenCalledOnce();
    // The visitor leaves here: no second activate request is sent.
    finish({ ok: true });
    await Promise.all(background);
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user")?.status,
    ).toBe("connected");
    expect(mocks.track).toHaveBeenCalledWith(
      "builder_signup_experiment_outcome",
      expect.objectContaining({ status: "connected" }),
      expect.anything(),
    );
  });

  it("confirms eligibility before the covered provider request on hosts without a background lifetime", async () => {
    session = signedSession();
    expect(await (await request({ operation: "start" })).json()).toEqual({
      status: "eligible",
    });
    expect(activate).not.toHaveBeenCalled();
    expect(await (await request({ operation: "activate" })).json()).toEqual({
      status: "connected",
    });
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user")?.status,
    ).toBe("connected");
  });

  it("retries only terminal persistence and never re-provisions after a write failure", async () => {
    session = signedSession();
    mocks.failTerminalWrites = 2;
    expect(await (await request({ operation: "activate" })).json()).toEqual({
      status: "connected",
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user")?.status,
    ).toBe("connected");
  });

  it("reports exhausted background outcome writes without retrying the provider", async () => {
    session = signedSession();
    mocks.failTerminalWrites = 3;
    const background: Promise<unknown>[] = [];
    mocks.waitUntil = (work) => {
      background.push(work);
    };
    expect(await (await request({ operation: "start" })).json()).toEqual({
      status: "pending",
    });
    expect(await Promise.all(background)).toEqual([
      { status: "pending", code: "outcome_write_failed" },
    ]);
    expect(activate).toHaveBeenCalledOnce();
    expect(mocks.track).toHaveBeenCalledWith(
      "builder_signup_experiment_activation_unavailable",
      expect.objectContaining({ code: "outcome_write_failed" }),
      expect.anything(),
    );
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user")?.status,
    ).toBe("started");
  });

  it.each(["status", "start", "activate"])(
    "reconciles a completed credential write during %s without re-provisioning",
    async (operation) => {
      session = signedSession();
      mocks.failTerminalWrites = 3;
      const background: Promise<unknown>[] = [];
      mocks.waitUntil = (work) => {
        background.push(work);
      };
      expect(await (await request({ operation: "start" })).json()).toEqual({
        status: "pending",
      });
      await Promise.all(background);
      const key = "design_builder_signup_v1:new-user";
      const reserved = mocks.settings.get(key);
      if (!reserved) throw new Error("Reservation missing");
      mocks.settings.set(key, { ...reserved, startedAt: Date.now() - 61_000 });
      reconcile.mockResolvedValue(true);
      const result = await request({ operation });
      expect(await result.json()).toEqual({
        status: "connected",
        code: "connection_reconciled",
      });
      expect(activate).toHaveBeenCalledOnce();
      expect(reconcile).toHaveBeenCalledWith(
        expect.anything(),
        session,
        expect.objectContaining({
          experimentId: "design_builder_signup_v1",
          attempt: reserved.attempt,
        }),
      );
      expect(
        mocks.track.mock.calls.filter(
          ([name]) => name === "builder_signup_experiment_outcome",
        ),
      ).toHaveLength(1);
      expect(await (await request({ operation: "status" })).json()).toEqual({
        status: "disabled",
        code: "already_completed",
      });
      expect(
        mocks.track.mock.calls.filter(
          ([name]) => name === "builder_signup_experiment_outcome",
        ),
      ).toHaveLength(1);
    },
  );

  it("preserves the distinct deployment and template provisioning identities", () => {
    expect(getBuilderSignupTrackingIdentity()).toEqual({
      agentNativeApp: "agent-native-clips",
      agentNativeTemplate: "clips",
    });
  });

  it("uses the hosted tracking identity when no app id is configured", () => {
    mocks.appId = undefined;
    vi.stubEnv("AGENT_NATIVE_APP", "agent-native-clips");
    try {
      expect(getBuilderSignupTrackingIdentity()).toEqual({
        agentNativeApp: "agent-native-clips",
        agentNativeTemplate: "clips",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["status", "start", "activate"])(
    "preserves an uncertain reservation during %s without calling the provider",
    async (operation) => {
      session = signedSession();
      mocks.waitUntil = () => {};
      mocks.settings.set("design_builder_signup_v1:new-user", {
        status: "started",
        startedAt: Date.now() - 61_000,
        attempt: "original-owner",
      });
      expect(await (await request({ operation })).json()).toEqual({
        status: "pending",
      });
      expect(activate).not.toHaveBeenCalled();
      expect(
        mocks.settings.get("design_builder_signup_v1:new-user")?.attempt,
      ).toBe("original-owner");
    },
  );

  it.each([false, true])(
    "does not enroll leftover anonymous assignments on start (background=%s)",
    async (background) => {
      session = signedSession();
      mocks.settings.clear();
      mocks.waitUntil = background ? () => {} : undefined;
      expect(
        await (
          await request(
            { operation: "start" },
            encodeBuilderSignupAssignment(accepted()),
          )
        ).json(),
      ).toEqual({ status: "disabled", code: "not_enrolled" });
      expect(activate).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();
    },
  );

  it("signals readiness only for a recently completed startup without replaying outcomes", async () => {
    session = signedSession();
    mocks.waitUntil = () => {};
    const key = "design_builder_signup_v1:new-user";
    mocks.settings.set(key, { status: "connected", completedAt: Date.now() });
    expect(await (await request({ operation: "start" })).json()).toEqual({
      status: "connected",
    });
    mocks.waitUntil = undefined;
    expect(await (await request({ operation: "start" })).json()).toEqual({
      status: "connected",
    });
    mocks.settings.set(key, {
      status: "connected",
      completedAt: Date.now() - 60_001,
    });
    for (const waitUntil of [undefined, () => {}]) {
      mocks.waitUntil = waitUntil;
      expect(await (await request({ operation: "start" })).json()).toEqual({
        status: "disabled",
        code: "already_completed",
      });
    }
    expect(await (await request({ operation: "activate" })).json()).toEqual({
      status: "connected",
    });
    expect(activate).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("keeps a recorded control assignment authoritative if automatic consent also exists", async () => {
    session = signedSession();
    mocks.settings.set("design_builder_signup_v1:new-user", {
      status: "control",
      variant: "control",
    });
    expect(await (await request({ operation: "status" })).json()).toEqual({
      status: "disabled",
      code: "already_completed",
    });
    expect(await (await request({ operation: "activate" })).json()).toEqual({
      status: "disabled",
      code: "control",
    });
    expect(activate).not.toHaveBeenCalled();
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user")?.status,
    ).toBe("control");
  });

  it("requires the original acceptance browser for consent recorded during unverified password signup", async () => {
    mocks.settings.clear();
    const cookie = encodeBuilderSignupAssignment({
      ...accepted(),
      method: "password",
      email: "new@example.com",
    });
    expect(
      await (
        await bindRequest(cookie, ATTEMPT, "password", "new@example.com")
      ).json(),
    ).toEqual({ bound: true });
    session = signedSession();
    for (const operation of ["status", "activate", "start"]) {
      expect(await (await request({ operation })).json()).toEqual({
        status: "disabled",
        code: "password_acceptance_cookie_required",
      });
    }
    expect(activate).not.toHaveBeenCalled();
    expect(mocks.settings.has("design_builder_signup_v1:new-user")).toBe(false);
    expect(
      await (await request({ operation: "status" }, cookie)).json(),
    ).toEqual({ status: "eligible" });
    expect(
      await (await request({ operation: "activate" }, cookie)).json(),
    ).toEqual({ status: "connected" });
    expect(activate).toHaveBeenCalledOnce();
  });

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
      startedAt: testTime - 1000,
    });
    const uncertain = await request({ operation: "status" });
    expect(await uncertain.json()).toEqual({
      status: "pending",
    });
    expect(uncertain.headers.get("set-cookie")).toBeNull();
    expect(await (await request({ operation: "start" })).json()).toEqual({
      status: "pending",
    });
    mocks.settings.set("design_builder_signup_v1:new-user", {
      status: "started",
      startedAt: testTime - 61000,
    });
    expect(await (await request({ operation: "start" })).json()).toEqual({
      status: "pending",
    });
    expect(activate).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
    mocks.track.mockClear();
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

  it("does not count an existing password identity as a new enrollment when signup is retried after acceptance", async () => {
    mocks.settings.clear();
    const assignment = { ...accepted(), method: "password" as const };
    mocks.identity.user.createdAt = new Date(testTime - 1500);
    expect(
      await (
        await bindRequest(
          encodeBuilderSignupAssignment(assignment),
          ATTEMPT,
          "password",
          "new@example.com",
        )
      ).json(),
    ).toEqual({ bound: false });
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.settings.size).toBe(0);
  });

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
    const connectError = async (userId: string) => {
      const app = createApp();
      app.use(
        "/status",
        defineEventHandler(async (event) => ({
          error: (await getBuilderSignupConnectError(event, userId)) ?? null,
        })),
      );
      return (await app.fetch(new Request("https://design.example.com/status")))
        .json()
        .then((body) => body.error);
    };
    expect(await connectError("new-user")).toEqual({
      code: "account_exists",
      message: "Connect the existing account",
      at: testTime,
    });
    expect(await connectError("another-user")).toBeNull();
  });

  describe("full-rollout graduation", () => {
    const control = () => ({
      id: "c".repeat(32),
      variant: "control" as const,
      issuedAt: testTime - 60_000,
      policy: BUILDER_SIGNUP_POLICY,
    });

    it("reissues an old control cookie as automatic before signup at 100%", async () => {
      mocks.automaticPercent = 100;
      mocks.assignmentRoll = 99;
      const response = await request(
        undefined,
        encodeBuilderSignupAssignment(control()),
      );
      const body = await response.json();
      expect(body).toMatchObject({ status: "assigned", variant: "automatic" });
      expect(body.id).not.toBe(control().id);
      expect(body.acceptedAt).toBeUndefined();
      const cookie = response.headers
        .getSetCookie()[0]
        ?.split(";")[0]
        ?.split("=")
        .slice(1)
        .join("=");
      expect(decodeBuilderSignupAssignment(cookie)).toMatchObject({
        id: body.id,
        variant: "automatic",
      });
      expect(mocks.track).toHaveBeenCalledWith(
        "builder_signup_experiment_reassigned",
        expect.objectContaining({
          assignment_id: control().id,
          experiment_variant: "control",
          reason: "full_rollout",
        }),
      );
      expect(activate).not.toHaveBeenCalled();
    });

    it("keeps control below a full rollout", async () => {
      mocks.automaticPercent = 99;
      const response = await request(
        undefined,
        encodeBuilderSignupAssignment(control()),
      );
      expect(await response.json()).toMatchObject({
        id: control().id,
        variant: "control",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("keeps an accepted automatic attempt unchanged at 100%", async () => {
      mocks.automaticPercent = 100;
      const response = await request(
        undefined,
        encodeBuilderSignupAssignment(accepted()),
      );
      expect(await response.json()).toMatchObject({
        id: accepted().id,
        attemptId: ATTEMPT,
        acceptedAt: accepted().acceptedAt,
      });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(mocks.track).not.toHaveBeenCalledWith(
        "builder_signup_experiment_reassigned",
        expect.anything(),
      );
    });
  });

  describe("hosted-only opt-in", () => {
    beforeEach(() => {
      mocks.enabled = false;
      mocks.hostedHosts = ["design.agent-native.com"];
      mocks.automaticPercent = 100;
    });

    it("assigns on a listed hosted host", async () => {
      const response = await request(undefined, undefined, {
        host: "design.agent-native.com",
      });
      expect(await response.json()).toMatchObject({
        status: "assigned",
        variant: "automatic",
      });
    });

    it.each([
      ["a copied template on its own domain", { host: "design.example.com" }],
      ["a lookalike subdomain", { host: "evil.design.agent-native.com" }],
      [
        "a forwarded host the proxy did not set",
        {
          host: "design.example.com",
          "x-forwarded-host": "design.agent-native.com",
        },
      ],
      ["a request with no host", {}],
    ])("stays disabled for %s", async (_case, headers) => {
      const response = await request(undefined, undefined, headers);
      expect(await response.json()).toEqual({ status: "disabled" });
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("accepts a matching forwarded host and port", async () => {
      const response = await request(undefined, undefined, {
        host: "design.agent-native.com:443",
        "x-forwarded-host": "design.agent-native.com",
      });
      expect((await response.json()).status).toBe("assigned");
    });

    it.each([
      ["a hosted host", { host: "design.agent-native.com" }, undefined, true],
      ["a copied template", { host: "design.example.com" }, undefined, false],
      [
        "a hosted host rolled back",
        { host: "design.agent-native.com" },
        false,
        false,
      ],
    ])(
      "attributes client failures on %s only when enabled there",
      async (_case, headers, override, attributed) => {
        mocks.override = override;
        const app = createApp();
        app.use(
          "/track",
          defineEventHandler((event) => ({
            failure:
              builderSignupClientFailureExperimentId(
                event,
                "builder_signup_experiment_client_failed",
              ) ?? null,
            other:
              builderSignupClientFailureExperimentId(event, "page_view") ??
              null,
          })),
        );
        const body = await (
          await app.fetch(
            new Request("https://design.example.com/track", { headers }),
          )
        ).json();
        expect(body).toEqual({
          failure: attributed ? "design_builder_signup_v1" : null,
          other: null,
        });
      },
    );

    it("lets the deployment override roll a hosted app back", async () => {
      mocks.override = false;
      const response = await request(undefined, undefined, {
        host: "design.agent-native.com",
      });
      expect(await response.json()).toEqual({ status: "disabled" });
    });

    it("is off by default for framework apps", async () => {
      mocks.hostedHosts = [];
      const response = await request(undefined, undefined, {
        host: "design.agent-native.com",
      });
      expect(await response.json()).toEqual({ status: "disabled" });
    });
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

  it.each([30_000, 61_000])(
    "preserves a slow provider owner after polling a %i ms reservation",
    async (age) => {
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
      mocks.settings.set(key, { ...running, startedAt: Date.now() - age });
      expect(
        await (await request({ operation: "activate" }, cookie)).json(),
      ).toEqual({ status: "pending" });
      expect(activate).toHaveBeenCalledOnce();
      finish({ ok: true });
      expect(await (await first).json()).toEqual({ status: "connected" });
      expect(mocks.settings.get(key)?.status).toBe("connected");
    },
  );

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
      startedAt: Date.now() - 1000,
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

  it("persists typed provision_failed and sanitizes unexpected error codes on activation failure", async () => {
    session = signedSession();
    activate.mockResolvedValueOnce({ ok: false, code: "provision_failed" });
    const cookie = encodeBuilderSignupAssignment(accepted());
    const response = await request({ operation: "activate" }, cookie);
    expect(await response.json()).toEqual({
      status: "fallback",
      code: "provision_failed",
    });
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user"),
    ).toMatchObject({ status: "fallback", code: "provision_failed" });
    expect(mocks.track).toHaveBeenCalledWith(
      "builder_signup_experiment_outcome",
      expect.objectContaining({
        status: "fallback",
        code: "provision_failed",
      }),
      expect.objectContaining({ authUserId: "new-user" }),
    );

    mocks.settings.delete("design_builder_signup_v1:new-user");
    mocks.track.mockClear();
    activate.mockResolvedValueOnce({
      ok: false,
      code: "bad code with secret=abc@example.com",
    });
    const sanitized = await request({ operation: "activate" }, cookie);
    expect(await sanitized.json()).toEqual({
      status: "fallback",
      code: "provision_failed",
    });
    expect(
      mocks.settings.get("design_builder_signup_v1:new-user"),
    ).toMatchObject({ status: "fallback", code: "provision_failed" });
  });

  describe("cross-browser magic-link landing handoff", () => {
    const newUserCallbackURL = `/_agent-native/auth/magic-link/new-user?builder_signup_attempt=${encodeURIComponent(ATTEMPT)}&return=%2F`;
    const magicToken = "magic-link-token-example-123456";

    async function issueCrossBrowserMagicLink(
      assignmentOverrides: Partial<ReturnType<typeof accepted>> = {},
    ) {
      const browserACookie = encodeBuilderSignupAssignment({
        ...accepted(),
        method: "magic-link",
        email: "new@example.com",
        ...assignmentOverrides,
      });
      const app = createApp();
      app.use(
        "/issue",
        defineEventHandler(async (event) => {
          await withMagicLinkBuilderSignupRecorder(
            event,
            ATTEMPT,
            "new@example.com",
            async () => {
              await mocks.magicLinkTokenHook?.("new@example.com", magicToken);
            },
          );
          return { ok: true };
        }),
      );
      await app.fetch(
        new Request("https://design.example.com/issue", {
          method: "POST",
          headers: {
            host: "design.example.com",
            cookie: `${builderSignupAssignmentCookieName()}=${browserACookie}`,
          },
        }),
      );
      return browserACookie;
    }

    function landingApp(
      options: { isTokenActive?: () => Promise<boolean> } = {},
    ) {
      const app = createApp();
      app.use(
        "/landing",
        defineEventHandler(async (event) => {
          if (event.req.method === "GET") {
            const url = new URL(event.req.url);
            const showDisclosure = await prepareMagicLinkLandingBuilderSignup(
              event,
              url.searchParams.get("token") ?? "",
              url.searchParams.get("newUserCallbackURL") ?? undefined,
              "https://design.example.com",
            );
            return { showDisclosure };
          }
          const body = (await event.req.json()) as {
            token: string;
            newUserCallbackURL?: string;
          };
          const confirmed = await confirmMagicLinkLandingBuilderSignup(
            event,
            body.token,
            body.newUserCallbackURL,
            "https://design.example.com",
            options.isTokenActive ?? (async () => true),
          );
          return { confirmed };
        }),
      );
      return app;
    }

    it("transfers consent to Browser B only after landing disclosure + same-origin POST and binds the new user", async () => {
      mocks.settings.clear();
      await issueCrossBrowserMagicLink();

      const app = landingApp();
      const getRes = await app.fetch(
        new Request(
          `https://design.example.com/landing?token=${encodeURIComponent(magicToken)}&newUserCallbackURL=${encodeURIComponent(newUserCallbackURL)}`,
          { headers: { host: "design.example.com" } },
        ),
      );
      expect(await getRes.json()).toEqual({ showDisclosure: true });
      const landingCookie = getRes.headers
        .get("set-cookie")
        ?.match(/an_builder_signup_landing=([^;]+)/)?.[1];
      expect(landingCookie).toBeTruthy();

      const postRes = await app.fetch(
        new Request("https://design.example.com/landing", {
          method: "POST",
          headers: {
            host: "design.example.com",
            origin: "https://design.example.com",
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
            cookie: `an_builder_signup_landing=${landingCookie}`,
          },
          body: JSON.stringify({ token: magicToken, newUserCallbackURL }),
        }),
      );
      expect(await postRes.json()).toEqual({ confirmed: true });
      const setCookies = postRes.headers.getSetCookie();
      const assignmentCookie = setCookies
        .find((c) => c.startsWith(`${builderSignupAssignmentCookieName()}=`))
        ?.match(/^[^=]+=([^;]+)/)?.[1];
      expect(assignmentCookie).toBeTruthy();
      expect(
        setCookies.some((c) => c.startsWith("an_builder_signup_pending=1")),
      ).toBe(true);
      if (!assignmentCookie) throw new Error("missing assignment cookie");

      const bound = await (
        await bindRequest(
          assignmentCookie,
          ATTEMPT,
          "magic-link",
          "new@example.com",
        )
      ).json();
      expect(bound).toEqual({ bound: true });

      const replay = await app.fetch(
        new Request("https://design.example.com/landing", {
          method: "POST",
          headers: {
            host: "design.example.com",
            origin: "https://design.example.com",
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
            cookie: `an_builder_signup_landing=${landingCookie}`,
          },
          body: JSON.stringify({ token: magicToken, newUserCallbackURL }),
        }),
      );
      expect(await replay.json()).toEqual({ confirmed: false });
    });

    it("rejects altered attempts, cross-site POSTs, missing landing cookies, inactive tokens, and skips Browser A", async () => {
      mocks.settings.clear();
      const browserACookie = await issueCrossBrowserMagicLink();
      const app = landingApp();

      const sameBrowser = await app.fetch(
        new Request(
          `https://design.example.com/landing?token=${encodeURIComponent(magicToken)}&newUserCallbackURL=${encodeURIComponent(newUserCallbackURL)}`,
          {
            headers: {
              host: "design.example.com",
              cookie: `${builderSignupAssignmentCookieName()}=${browserACookie}`,
            },
          },
        ),
      );
      expect(await sameBrowser.json()).toEqual({ showDisclosure: false });

      const tamperedAttempt = await app.fetch(
        new Request(
          `https://design.example.com/landing?token=${encodeURIComponent(magicToken)}&newUserCallbackURL=${encodeURIComponent("/_agent-native/auth/magic-link/new-user?builder_signup_attempt=wrong")}`,
          { headers: { host: "design.example.com" } },
        ),
      );
      expect(await tamperedAttempt.json()).toEqual({ showDisclosure: false });

      const getRes = await app.fetch(
        new Request(
          `https://design.example.com/landing?token=${encodeURIComponent(magicToken)}&newUserCallbackURL=${encodeURIComponent(newUserCallbackURL)}`,
          { headers: { host: "design.example.com" } },
        ),
      );
      const landingCookie = getRes.headers
        .get("set-cookie")
        ?.match(/an_builder_signup_landing=([^;]+)/)?.[1];
      expect(landingCookie).toBeTruthy();

      const crossSite = await app.fetch(
        new Request("https://design.example.com/landing", {
          method: "POST",
          headers: {
            host: "design.example.com",
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
            "content-type": "application/json",
            cookie: `an_builder_signup_landing=${landingCookie}`,
          },
          body: JSON.stringify({ token: magicToken, newUserCallbackURL }),
        }),
      );
      expect(await crossSite.json()).toEqual({ confirmed: false });

      const noCookie = await app.fetch(
        new Request("https://design.example.com/landing", {
          method: "POST",
          headers: {
            host: "design.example.com",
            origin: "https://design.example.com",
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
          },
          body: JSON.stringify({ token: magicToken, newUserCallbackURL }),
        }),
      );
      expect(await noCookie.json()).toEqual({ confirmed: false });

      const inactiveApp = landingApp({ isTokenActive: async () => false });
      const inactive = await inactiveApp.fetch(
        new Request("https://design.example.com/landing", {
          method: "POST",
          headers: {
            host: "design.example.com",
            origin: "https://design.example.com",
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
            cookie: `an_builder_signup_landing=${landingCookie}`,
          },
          body: JSON.stringify({ token: magicToken, newUserCallbackURL }),
        }),
      );
      expect(await inactive.json()).toEqual({ confirmed: false });
    });
  });

  describe("deferred Google signup receipt (mobile / desktop exchange)", () => {
    const sessionToken = "google-oauth-issued-session-token";

    it("records a single-use receipt and consumes it only with the originating client cookie", async () => {
      mocks.settings.clear();
      const clientCookie = encodeBuilderSignupAssignment(accepted());
      const app = createApp();
      app.use(
        "/record",
        defineEventHandler(async (event) => {
          await recordDeferredGoogleSignupReceipt(
            event,
            sessionToken,
            ATTEMPT,
            "new@example.com",
          );
          return { ok: true };
        }),
      );
      app.use(
        "/consume",
        defineEventHandler(async (event) => ({
          attemptId: await consumeDeferredGoogleSignupReceipt(
            event,
            sessionToken,
            "new@example.com",
          ),
        })),
      );

      const rec = await app.fetch(
        new Request("https://design.example.com/record", {
          headers: { host: "design.example.com" },
        }),
      );
      expect(await rec.json()).toEqual({ ok: true });

      const noCookie = await app.fetch(
        new Request("https://design.example.com/consume", {
          headers: { host: "design.example.com" },
        }),
      );
      expect(await noCookie.json()).toEqual({ attemptId: null });

      const consumed = await app.fetch(
        new Request("https://design.example.com/consume", {
          headers: {
            host: "design.example.com",
            cookie: `${builderSignupAssignmentCookieName()}=${clientCookie}`,
          },
        }),
      );
      expect(await consumed.json()).toEqual({ attemptId: ATTEMPT });

      const replay = await app.fetch(
        new Request("https://design.example.com/consume", {
          headers: {
            host: "design.example.com",
            cookie: `${builderSignupAssignmentCookieName()}=${clientCookie}`,
          },
        }),
      );
      expect(await replay.json()).toEqual({ attemptId: null });
    });
  });
});
