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
  consumeDeferredGoogle: vi.fn(async () => null),
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
  consumeDeferredGoogleSignupReceipt: mocks.consumeDeferredGoogle,
  prepareMagicLinkLandingBuilderSignup: mocks.prepareMagicLinkLanding,
  confirmMagicLinkLandingBuilderSignup: mocks.confirmMagicLinkLanding,
  withMagicLinkBuilderSignupRecorder: mocks.withMagicLinkRecorder,
}));
import { getSession, recordBuilderSignupBinding } from "./auth.js";
beforeEach(() => {
  mocks.bind.mockReset().mockResolvedValue({ userId: "qa-user" });
  mocks.start.mockReset().mockResolvedValue(undefined);
  mocks.recordDeferredGoogle.mockReset().mockResolvedValue(false);
  mocks.consumeDeferredGoogle.mockReset().mockResolvedValue(null);
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
        defineEventHandler(async (event) => {
          await recordBuilderSignupBinding(
            event,
            "test-only-signup-attempt",
            "google",
            signed.email,
            signed,
          );
          return { signedIn: true };
        }),
      );
      expect(
        (await server.fetch(new Request("https://apps.example.com/callback")))
          .status,
      ).toBe(200);
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
});
