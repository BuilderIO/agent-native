import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  getRequestUserEmail: vi.fn<() => string | undefined>(),
}));

vi.mock("@agent-native/core/tracking", () => ({ track: mocks.track }));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import {
  isHumanCaller,
  trackDesign,
  trackingErrorType,
} from "./design-tracking.js";

describe("trackDesign", () => {
  beforeEach(() => {
    mocks.track.mockReset();
    mocks.getRequestUserEmail.mockReset();
  });

  it("adds the app names and the action's join keys, keeping the ctx as the source", () => {
    const ctx = {
      caller: "tool",
      userEmail: "owner@example.test",
      runId: "run-1",
      turnId: "turn-1",
      threadId: "thread-1",
    } as never;

    trackDesign("design_edited", { output_id: "d1" }, ctx);

    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith(
      "design_edited",
      {
        output_id: "d1",
        run_id: "run-1",
        turn_id: "turn-1",
        thread_id: "thread-1",
        caller: "tool",
        app_name: "design",
        template_name: "design",
      },
      ctx,
    );
  });

  it("does not let callers override the app names", () => {
    trackDesign("x", { app_name: "slides", template_name: "slides" }, {
      caller: "frontend",
    } as never);

    expect(mocks.track.mock.calls[0]?.[1]).toMatchObject({
      app_name: "design",
      template_name: "design",
    });
  });

  it("attributes a ctx-less route call to the request's user", () => {
    mocks.getRequestUserEmail.mockReturnValue("route@example.test");

    trackDesign("x", {});

    expect(mocks.track.mock.calls[0]?.[2]).toEqual({
      userId: "route@example.test",
    });
  });

  it("passes a plain tracking source through without join keys", () => {
    trackDesign("x", {}, { anonymousId: "anon-1" });

    expect(mocks.track.mock.calls[0]?.[1]).not.toHaveProperty("caller");
    expect(mocks.track.mock.calls[0]?.[2]).toEqual({ anonymousId: "anon-1" });
  });

  it("never throws when tracking throws", () => {
    mocks.track.mockImplementation(() => {
      throw new Error("provider down");
    });

    expect(() =>
      trackDesign("x", {}, { caller: "frontend" } as never),
    ).not.toThrow();
  });
});

describe("isHumanCaller", () => {
  it("is true only for requests from the Design UI", () => {
    expect(isHumanCaller({ caller: "frontend" } as never)).toBe(true);
    for (const caller of ["tool", "mcp", "a2a", "http", "automation", "cli"]) {
      expect(isHumanCaller({ caller } as never)).toBe(false);
    }
    expect(isHumanCaller(undefined)).toBe(false);
    expect(isHumanCaller({ userId: "u" })).toBe(false);
  });
});

describe("trackingErrorType", () => {
  it("names HTTP failures and cancellations without leaking messages", () => {
    expect(trackingErrorType({ statusCode: 403, message: "secret" })).toBe(
      "http_403",
    );
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(trackingErrorType(abort)).toBe("cancelled");
    expect(trackingErrorType(new Error("anything"))).toBe("error");
    expect(trackingErrorType(undefined)).toBe("error");
  });
});
