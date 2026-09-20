import { describe, expect, it } from "vitest";

import { dbExecToolParameters } from "./tool-schemas.js";

describe("dbExecToolParameters", () => {
  it("requires exactly one write mode", () => {
    expect(dbExecToolParameters()).toMatchObject({
      additionalProperties: false,
      oneOf: [{ required: ["sql"] }, { required: ["statements"] }],
    });
  });
});
