import { createApp, defineEventHandler, type H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "./auth.js";
const mocks = vi.hoisted(() => ({
  cookie: "",
  bind: vi.fn(
    async (): Promise<{ userId: string } | false> => ({ userId: "qa-user" }),
  ),
  start: vi.fn(async (_event: H3Event, _session: AuthSession) => {}),
}));
vi.mock("./builder-signup-experiment.js", () => ({
  builderSignupAssignmentCookieName: () => mocks.cookie,
  bindBuilderSignupAttempt: mocks.bind,
  startBuilderSignupForVerifiedSession: mocks.start,
}));
import { getSession, recordBuilderSignupBinding } from "./auth.js";
beforeEach(() => {
  mocks.bind.mockReset().mockResolvedValue({ userId: "qa-user" });
  mocks.start.mockReset().mockResolvedValue(undefined);
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
      if (bound)
        expect(mocks.start).toHaveBeenCalledWith(expect.anything(), {
          ...signed,
          userId: "qa-user",
        });
      else expect(mocks.start).not.toHaveBeenCalled();
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
