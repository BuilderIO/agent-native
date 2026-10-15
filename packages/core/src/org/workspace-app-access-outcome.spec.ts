import { describe, expect, it } from "vitest";

import {
  describeFetchFailure,
  isWorkspaceAppAccessUnavailable,
  registryErrorDetail,
  WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE,
  workspaceAppAccessUnavailable,
  workspaceAppAccessUnavailableBody,
} from "./workspace-app-access-outcome.js";

describe("workspace app access outcome", () => {
  it("tells an unavailable outcome apart from a verdict", () => {
    const outcome = workspaceAppAccessUnavailable("registry-timeout");

    expect(isWorkspaceAppAccessUnavailable(outcome)).toBe(true);
    expect(isWorkspaceAppAccessUnavailable(true)).toBe(false);
    expect(isWorkspaceAppAccessUnavailable(false)).toBe(false);
    expect(isWorkspaceAppAccessUnavailable(null)).toBe(false);
    expect(isWorkspaceAppAccessUnavailable("unavailable")).toBe(false);
  });

  it("builds a 503 body that keeps the stable message and adds the cause", () => {
    const body = workspaceAppAccessUnavailableBody(
      workspaceAppAccessUnavailable("registry-http-error", {
        upstreamStatus: 401,
        audience: "https://workspace.example.test/dispatch",
        detail: "Unauthorized",
      }),
    );

    expect(body).toEqual({
      error: WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE,
      code: "registry-http-error",
      upstreamStatus: 401,
      audience: "https://workspace.example.test/dispatch",
      detail: "Unauthorized",
    });
  });

  it("omits fields that were never known instead of sending empty values", () => {
    expect(
      workspaceAppAccessUnavailableBody(
        workspaceAppAccessUnavailable("a2a-secret-missing"),
      ),
    ).toEqual({
      error: WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE,
      code: "a2a-secret-missing",
    });
  });

  it("bounds upstream detail and strips control characters", () => {
    const outcome = workspaceAppAccessUnavailable("registry-http-error", {
      detail: `line one\n\tline two\u0000${"x".repeat(400)}`,
    });

    expect(outcome.detail).not.toMatch(/[\u0000-\u001f]/);
    expect(outcome.detail?.startsWith("line one line two")).toBe(true);
    expect(outcome.detail?.length).toBeLessThanOrEqual(161);
    expect(outcome.detail?.endsWith("…")).toBe(true);
  });

  it("drops detail that is only whitespace", () => {
    expect(
      workspaceAppAccessUnavailable("registry-http-error", { detail: " \n " }),
    ).not.toHaveProperty("detail");
  });

  describe("registryErrorDetail", () => {
    it.each([
      [{ error: "Unauthorized" }, "Unauthorized"],
      [{ statusMessage: "Bad Gateway" }, "Bad Gateway"],
      [{ message: "boom" }, "boom"],
    ])("falls back to the first readable text in %j", (body, expected) => {
      expect(registryErrorDetail(body)).toBe(expected);
    });

    it.each([null, undefined, "text", 42, {}, { error: 7 }, { error: "  " }])(
      "yields nothing for an unreadable body %j",
      (body) => {
        expect(registryErrorDetail(body)).toBeUndefined();
      },
    );
  });

  describe("describeFetchFailure", () => {
    it("names the class and the cause code, never the message", () => {
      const error = Object.assign(new TypeError("fetch failed: db:5432"), {
        cause: { code: "ENOTFOUND" },
      });

      expect(describeFetchFailure(error)).toEqual({
        timedOut: false,
        detail: "TypeError:ENOTFOUND",
      });
    });

    it.each(["AbortError", "TimeoutError"])(
      "treats %s as a timeout",
      (name) => {
        const error = new Error("aborted");
        error.name = name;

        expect(describeFetchFailure(error)).toEqual({
          timedOut: true,
          detail: name,
        });
      },
    );

    it("does not throw on a non-Error rejection", () => {
      expect(describeFetchFailure("nope")).toEqual({
        timedOut: false,
        detail: "UnknownError",
      });
    });
  });
});
