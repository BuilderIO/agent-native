import { createApp, defineEventHandler } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cookie: "", bind: vi.fn(async () => true) }));
vi.mock("./builder-signup-experiment.js", () => ({
  builderSignupAssignmentCookieName: () => mocks.cookie,
  bindBuilderSignupAttempt: mocks.bind,
}));
import { recordBuilderSignupBinding } from "./auth.js";
beforeEach(() => mocks.bind.mockClear());
describe("signup callback experiment binding", () => {
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
