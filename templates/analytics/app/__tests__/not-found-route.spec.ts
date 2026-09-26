import { describe, expect, it } from "vitest";

import { loader } from "../routes/$";


describe("catch-all not-found route", () => {
  it("reports HTTP 404 for an unmatched path", () => {
    const result = loader();
    expect(result).toMatchObject({
      type: "DataWithResponseInit",
      init: { status: 404 },
    });
  });
});
