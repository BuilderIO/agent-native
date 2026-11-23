import { createApp, defineEventHandler, type H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "./auth.js";
const mocks = vi.hoisted(() => ({
  cookie: "",
  bind: vi.fn(
    async (): Promise<{ userId: string } | false> => ({ userId: "qa-user" }),
  ),
  start: vi.fn(async (_event: H3Event, _session: AuthSession) => {}),
  recordDeferredGoogle: vi.fn(async () => false),
  readDeferredGoogle: vi.fn(async () => null),
  deleteDeferredGoogle: vi.fn(async () => {}),
  prepareMagicLinkLanding: vi.fn(async () => false),
  confirmMagicLinkLanding: vi.fn(async () => false),
  withMagicLinkRecorder: vi.fn(
    async (
      _event: H3Event,
      _email: string,
      _attemptId: unknown,
      run: () => Promise<unknown>,
    ) => run(),
  ),
}));
vi.mock("./builder-signup-experiment.js", () => ({
  builderSignupAssignmentCookieName: () => mocks.cookie,
  bindBuilderSignupAttempt: mocks.bind,
  startBuilderSignupForVerifiedSession: mocks.start,
  recordDeferredGoogleSignupReceipt: mocks.recordDeferredGoogle,
  readDeferredGoogleSignupReceipt: mocks.readDeferredGoogle,
  deleteDeferredGoogleSignupReceipt: mocks.deleteDeferredGoogle,
  prepareMagicLinkLandingBuilderSignup: mocks.prepareMagicLinkLanding,
  confirmMagicLinkLandingBuilderSignup: mocks.confirmMagicLinkLanding,
  withMagicLinkBuilderSignupRecorder: mocks.withMagicLinkRecorder,
}));
import { getSession, recordBuilderSignupBinding } from "./auth.js";
beforeEach(() => {
  mocks.bind.mockReset().mockResolvedValue({ userId: "qa-user" });
  mocks.start.mockReset().mockResolvedValue(undefined);
  mocks.recordDeferredGoogle.mockReset().mockResolvedValue(false);
  mocks.readDeferredGoogle.mockReset().mockResolvedValue(null);
  mocks.deleteDeferredGoogle.mockReset();
});
describe("signup callback experiment binding", () => {
  it.each([
    { bound: true, hasAnalyticsId: true },
    { bound: true, hasAnalyticsId: false },
    { bound: false, hasAnalyticsId: false },
  ])(
    "starts only a bound callback using its canonical identity (%o)",
    async ({ bound, hasAnalyticsId }) => {
      mocks.cookie = "an_builder_signup";
      mocks.bind.mockResolvedValue(bound ? { userId: "qa-user" } : false);
      const signed = {
        email: "qa@example.invalid",
        ...(hasAnalyticsId ? { userId: "qa-user" } : {}),
        token: "test-only-issued-session",
        emailVerified: true,
      };
      const observedSessions: Array<AuthSession | null> = [];
      mocks.start.mockImplementation(async (event) => {
        observedSessions.push(await getSession(event));
      });
      const server = createApp();
      server.use(
        "/callback",
        defineEventHandler(async (event) => ({
          started: await recordBuilderSignupBinding(
            event,
            "test-only-signup-attempt",
            "google",
            signed.email,
            signed,
          ),
        })),
      );
      const response = await server.fetch(
        new Request("https://apps.example.com/callback"),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ started: bound });
      expect(observedSessions).toEqual(
        bound ? [{ ...signed, userId: "qa-user" }] : [],
      );
      expect(mocks.start.mock.calls.map(([, s]) => s)).toEqual(
        bound ? [{ ...signed, userId: "qa-user" }] : [],
      );
      expect(
        mocks.recordDeferredGoogle.mock.calls.map(([, ...rest]) => rest),
      ).toEqual(
        bound ? [] : [[signed.token, "test-only-signup-attempt", signed.email]],
      );
    },
  );
  it.each(["clips", "slides"])(
    "records a %s control callback without an attempt ID",
    async (app) => {
      mocks.cookie = `an_builder_signup_${Buffer.from(`${app}_builder_signup_v1`).toString("hex")}`;
      const server = createApp();
      server.use(
        "/callback",
        defineEventHandler(async (event) => {
          await recordBuilderSignupBinding(
            event,
            undefined,
            "google",
            "qa@example.invalid",
          );
          return { ok: true };
        }),
      );
      const r = await server.fetch(
        new Request("https://apps.example.com/callback", {
          headers: { cookie: `${mocks.cookie}=signed-control-assignment` },
        }),
      );
      expect(r.status).toBe(200);
      expect(mocks.bind).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        "google",
        "qa@example.invalid",
      );
    },
  );

  it("reports a bound signup whose start fails as not started, so its receipt is kept for retry", async () => {
    mocks.cookie = "an_builder_signup";
    mocks.bind.mockResolvedValue({ userId: "qa-user" });
    mocks.start.mockRejectedValue(new Error("provider unavailable"));
    const server = createApp();
    server.use(
      "/callback",
      defineEventHandler(async (event) => ({
        started: await recordBuilderSignupBinding(
          event,
          "test-only-signup-attempt",
          "google",
          "qa@example.invalid",
          {
            email: "qa@example.invalid",
            token: "test-only-issued-session",
            emailVerified: true,
          },
        ),
      })),
    );
    const response = await server.fetch(
      new Request("https://apps.example.com/callback"),
    );
    expect(await response.json()).toEqual({ started: false });
  });

  describe("deferred Google receipt and start eligibility", () => {
    const ATTEMPT = "test-only-signup-attempt";
    const EMAIL = "qa@example.invalid";
    const verified = (overrides: Partial<AuthSession> = {}): AuthSession => ({
      email: EMAIL,
      token: "test-only-issued-session",
      emailVerified: true,
      ...overrides,
    });

    async function callback(options: {
      attemptId?: unknown;
      method?: "password" | "magic-link" | "google";
      email?: string;
      session?: AuthSession | undefined;
      cookie?: boolean;
    }) {
      mocks.cookie = "an_builder_signup";
      const server = createApp();
      server.use(
        "/callback",
        defineEventHandler(async (event) => {
          await recordBuilderSignupBinding(
            event,
            "attemptId" in options ? options.attemptId : ATTEMPT,
            options.method ?? "google",
            options.email ?? EMAIL,
            "session" in options ? options.session : verified(),
          );
          return { ok: true };
        }),
      );
      await server.fetch(
        new Request("https://apps.example.com/callback", {
          headers: options.cookie ? { cookie: "an_builder_signup=held" } : {},
        }),
      );
    }

    it("records a receipt with the original email when the verified session email differs only by case and whitespace", async () => {
      mocks.bind.mockResolvedValue(false);
      await callback({ email: "  QA@Example.Invalid " });
      expect(mocks.recordDeferredGoogle).toHaveBeenCalledTimes(1);
      expect(
        mocks.recordDeferredGoogle.mock.calls.map(([, ...rest]) => rest),
      ).toEqual([
        ["test-only-issued-session", ATTEMPT, "  QA@Example.Invalid "],
      ]);
    });

    it.each([
      {
        name: "a non-google method",
        options: { method: "magic-link" as const },
      },
      { name: "a held assignment cookie", options: { cookie: true } },
      {
        name: "a missing attempt id",
        options: { attemptId: undefined, cookie: true },
      },
      {
        name: "a non-string attempt id",
        options: { attemptId: 42 as unknown },
      },
      {
        name: "an unverified session",
        options: {
          session: { email: EMAIL, token: "t", emailVerified: false },
        },
      },
      {
        name: "an undefined verification flag",
        options: { session: { email: EMAIL, token: "t" } },
      },
      {
        name: "a session without a token",
        options: { session: { email: EMAIL, emailVerified: true } },
      },
      {
        name: "an empty session token",
        options: { session: { email: EMAIL, token: "", emailVerified: true } },
      },
      {
        name: "a different session email",
        options: {
          session: {
            email: "other@example.invalid",
            token: "t",
            emailVerified: true,
          },
        },
      },
      { name: "no session", options: { session: undefined } },
    ])("does not record a deferred receipt for $name", async ({ options }) => {
      mocks.bind.mockResolvedValue(false);
      await callback(options);
      expect(mocks.recordDeferredGoogle).not.toHaveBeenCalled();
      expect(mocks.start).not.toHaveBeenCalled();
    });

    it("skips binding entirely without an attempt id or assignment cookie", async () => {
      await callback({ attemptId: undefined });
      expect(mocks.bind).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: "an unverified session",
        session: { email: EMAIL, token: "t", emailVerified: false },
      },
      {
        name: "an undefined verification flag",
        session: { email: EMAIL, token: "t" },
      },
      {
        name: "a session without a token",
        session: { email: EMAIL, emailVerified: true },
      },
      {
        name: "a different session email",
        session: {
          email: "other@example.invalid",
          token: "t",
          emailVerified: true,
        },
      },
    ])(
      "does not start provisioning for a bound attempt with $name",
      async ({ session }) => {
        await callback({ session });
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.recordDeferredGoogle).not.toHaveBeenCalled();
      },
    );

    it("starts provisioning with the bound identity when the session email differs only by case", async () => {
      await callback({ session: verified({ email: "QA@EXAMPLE.INVALID" }) });
      expect(mocks.start.mock.calls.map(([, s]) => s)).toEqual([
        verified({ email: "QA@EXAMPLE.INVALID", userId: "qa-user" }),
      ]);
      expect(mocks.recordDeferredGoogle).not.toHaveBeenCalled();
    });

    it("does not surface a binding failure to the callback", async () => {
      mocks.bind.mockRejectedValueOnce(new Error("bind unavailable"));
      await expect(callback({})).resolves.toBeUndefined();
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.recordDeferredGoogle).not.toHaveBeenCalled();
    });
  });
});
