import { createApp } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  identity: { user: { id: "new-user", createdAt: new Date() } },
  settings: new Map<string, Record<string, unknown>>(),
  track: vi.fn(),
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({
    onboarding: { builderSignupExperiment: mocks.enabled },
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
  createBuilderSignupExperimentHandler,
  decodeBuilderSignupAssignment,
  encodeBuilderSignupAssignment,
} from "./builder-signup-experiment.js";

const accepted = () => ({
  id: "a".repeat(32),
  variant: "automatic" as const,
  issuedAt: Date.now() - 2000,
  acceptedAt: Date.now() - 1000,
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

beforeEach(() => {
  mocks.enabled = true;
  mocks.identity = { user: { id: "new-user", createdAt: new Date() } };
  mocks.settings.clear();
  mocks.track.mockClear();
  session = null;
  sameOrigin = true;
  activate = vi.fn(async () => ({ ok: true }));
});

describe("pre-signup Builder experiment", () => {
  it("does not assign or write cookies when disabled", async () => {
    mocks.enabled = false;
    const response = await request();
    expect(await response.json()).toEqual({ status: "disabled" });
    expect(response.headers.get("set-cookie")).toBeNull();
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
      { operation: "accept", assignmentId: assignment.id },
      cookie,
    );
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    session = signedSession();
    expect(
      (
        await request(
          { operation: "accept", assignmentId: assignment.id },
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
    ).toEqual({ status: "fallback" });
    expect(activate).not.toHaveBeenCalled();
  });
  it("never provisions control accounts", async () => {
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
      expect.objectContaining({ experiment_variant: "control" }),
      expect.anything(),
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
    expect([...mocks.settings.values()][0]).toMatchObject({
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
