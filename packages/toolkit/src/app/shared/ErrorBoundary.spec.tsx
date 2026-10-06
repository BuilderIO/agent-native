import { describe, expect, it } from "vitest";

import { isExpectedRouteNotFound } from "./ErrorBoundary.js";

describe("isExpectedRouteNotFound", () => {
  it("recognizes React Router 404 responses", () => {
    expect(
      isExpectedRouteNotFound({
        data: "missing",
        internal: true,
        status: 404,
        statusText: "Not Found",
      }),
    ).toBe(true);
  });

  it("keeps application errors reportable", () => {
    expect(isExpectedRouteNotFound(new Error("render failed"))).toBe(false);
    expect(
      isExpectedRouteNotFound({
        data: "failed",
        internal: true,
        status: 500,
        statusText: "Server Error",
      }),
    ).toBe(false);
  });
});
