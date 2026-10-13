import { describe, expect, it } from "vitest";

import { composerSourceRequestSchema } from "./composer-source.js";

describe("composer integration intents", () => {
  it("accepts a selected integration as a read-only source", () => {
    expect(
      composerSourceRequestSchema.parse({
        source: "integration",
        operation: "read",
        id: "github",
      }),
    ).toMatchObject({ source: "integration", operation: "read", id: "github" });
  });

  it("requires an integration id and rejects list operations", () => {
    expect(
      composerSourceRequestSchema.safeParse({
        source: "integration",
        operation: "read",
      }).success,
    ).toBe(false);
    expect(
      composerSourceRequestSchema.safeParse({
        source: "integration",
        operation: "list",
        id: "github",
      }).success,
    ).toBe(false);
  });
});
