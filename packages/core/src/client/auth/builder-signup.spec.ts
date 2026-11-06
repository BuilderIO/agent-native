import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api-path.js", () => ({ agentNativePath: (path: string) => path }));

import {
  acceptBuilderSignupAssignment,
  activateBuilderSignupAssignment,
  getBuilderSignupAssignment,
  hasPendingBuilderSignupAssignment,
} from "./builder-signup.js";

const assignment = {
  status: "assigned",
  id: "visitor-example",
  variant: "automatic",
  policy: "policy-example",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Builder signup client contract", () => {
  it("reads the assigned arm without exposing an auth credential to the browser", async () => {
    const fetch = vi.fn(async () => response(assignment));
    vi.stubGlobal("fetch", fetch);
    expect(await getBuilderSignupAssignment()).toEqual(assignment);
    expect(fetch).toHaveBeenCalledWith(
      "/_agent-native/auth/builder-signup-experiment",
      expect.objectContaining({
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    { status: "assigned", id: "visitor", variant: "unknown", policy: "policy" },
    { status: "assigned", variant: "control", policy: "policy" },
    { status: "unavailable" },
    [],
  ])(
    "rejects an unreadable assignment instead of treating it as control: %j",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response(body)),
      );
      await expect(getBuilderSignupAssignment()).rejects.toThrow();
    },
  );

  it("preserves an explicit disabled decision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ status: "disabled" })),
    );
    expect(await getBuilderSignupAssignment()).toEqual({ status: "disabled" });
  });

  it("requires the server to acknowledge the displayed assignment before signup", async () => {
    const fetch = vi.fn(async () => response({ status: "accepted" }));
    vi.stubGlobal("fetch", fetch);
    await acceptBuilderSignupAssignment(
      "visitor-example",
      "signup-attempt-example",
      "password",
      "new@example.com",
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      operation: "accept",
      assignmentId: "visitor-example",
      attemptId: "signup-attempt-example",
      method: "password",
      email: "new@example.com",
    });
    fetch.mockResolvedValueOnce(response({ status: "fallback" }));
    await expect(
      acceptBuilderSignupAssignment(
        "visitor-example",
        "signup-attempt-example",
        "password",
        "new@example.com",
      ),
    ).rejects.toThrow();
  });

  it.each(["connected", "fallback", "disabled"] as const)(
    "preserves the %s activation outcome",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response({ status })),
      );
      expect(await activateBuilderSignupAssignment()).toBe(status);
    },
  );

  it("waits for an in-flight activation rather than reporting it completed", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ status: "pending" }))
      .mockResolvedValueOnce(response({ status: "connected" }));
    vi.stubGlobal("fetch", fetch);
    const result = activateBuilderSignupAssignment();
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe("connected");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not turn transport errors or unknown outcomes into a connected state", async () => {
    const fetch = vi.fn(async () => response({ status: "connected" }, 503));
    vi.stubGlobal("fetch", fetch);
    await expect(activateBuilderSignupAssignment()).rejects.toThrow(/503/);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(response({ status: "unknown" }));
    await expect(activateBuilderSignupAssignment()).rejects.toThrow(
      /did not complete/,
    );
  });

  it("only checks activation for the non-secret pending cookie", () => {
    expect(hasPendingBuilderSignupAssignment()).toBe(false);
    vi.stubGlobal("document", {
      cookie: "other=1; an_builder_signup_pending=1",
    });
    expect(hasPendingBuilderSignupAssignment()).toBe(true);
    vi.stubGlobal("document", { cookie: "not_an_builder_signup_pending=1" });
    expect(hasPendingBuilderSignupAssignment()).toBe(false);
  });
});
