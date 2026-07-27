import { describe, expect, it } from "vitest";

import { describeErrorWithCauses } from "./error-detail.js";

describe("describeErrorWithCauses", () => {
  it("returns the bare message when there is no cause", () => {
    expect(describeErrorWithCauses(new Error("Connection error."))).toBe(
      "Connection error.",
    );
  });

  it("appends the cause chain with each link's code", () => {
    const socket = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    });
    const fetchFailed = new Error("fetch failed", { cause: socket });
    const apiError = new Error("Connection error.", { cause: fetchFailed });

    expect(describeErrorWithCauses(apiError)).toBe(
      "Connection error. (cause: fetch failed <- UND_ERR_SOCKET other side closed)",
    );
  });

  it("bounds the chain and survives a cycle", () => {
    const deepest = new Error("l5");
    let err: Error = deepest;
    for (const label of ["l4", "l3", "l2", "l1"]) {
      err = new Error(label, { cause: err });
    }
    (deepest as Error & { cause?: unknown }).cause = err;

    const described = describeErrorWithCauses(err);
    expect(described).toBe("l1 (cause: l2 <- l3 <- l4 <- l5)");
  });

  it("handles non-Error values", () => {
    expect(describeErrorWithCauses("boom")).toBe("boom");
  });
});
