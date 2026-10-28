import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signInternalToken } from "../../integrations/internal-token.js";
import { RECURRING_JOBS_SWEEP_TOKEN_SUBJECT } from "../../jobs/scheduler-dispatch.js";
import { authorizeSweepTrigger } from "./sweep-trigger-auth.js";

describe("authorizeSweepTrigger", () => {
  let prevSecret: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.A2A_SECRET;
    process.env.A2A_SECRET = "test-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.A2A_SECRET;
    else process.env.A2A_SECRET = prevSecret;
  });

  it("accepts the signed POST that Netlify and Cloudflare send", () => {
    const token = signInternalToken(RECURRING_JOBS_SWEEP_TOKEN_SUBJECT);

    expect(
      authorizeSweepTrigger({
        method: "POST",
        authorization: `Bearer ${token}`,
        cronSecret: undefined,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a POST signed for another subject", () => {
    const token = signInternalToken("some-run-id");

    expect(
      authorizeSweepTrigger({
        method: "POST",
        authorization: `Bearer ${token}`,
        cronSecret: "cron-secret",
      }),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("does not accept the cron secret on a POST", () => {
    expect(
      authorizeSweepTrigger({
        method: "POST",
        authorization: "Bearer cron-secret",
        cronSecret: "cron-secret",
      }),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("accepts the GET Vercel Cron sends with CRON_SECRET", () => {
    expect(
      authorizeSweepTrigger({
        method: "GET",
        authorization: "Bearer cron-secret",
        cronSecret: "cron-secret",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a GET with the wrong or no cron secret", () => {
    for (const authorization of [
      "Bearer wrong-secret",
      "Bearer cron-secret-but-longer",
      "cron-secret",
      undefined,
    ]) {
      expect(
        authorizeSweepTrigger({
          method: "GET",
          authorization,
          cronSecret: "cron-secret",
        }),
      ).toMatchObject({ ok: false, status: 401 });
    }
  });

  // Without a configured secret there is nothing to compare against, so the
  // request is refused as a deploy problem rather than treated as a bad caller.
  it("refuses every GET when CRON_SECRET is not configured", () => {
    for (const cronSecret of [undefined, ""]) {
      expect(
        authorizeSweepTrigger({
          method: "GET",
          authorization: "Bearer ",
          cronSecret,
        }),
      ).toMatchObject({ ok: false, status: 503 });
    }
  });

  it("rejects other methods", () => {
    expect(
      authorizeSweepTrigger({
        method: "PUT",
        authorization: "Bearer cron-secret",
        cronSecret: "cron-secret",
      }),
    ).toMatchObject({ ok: false, status: 405 });
  });
});
