import { describe, expect, it } from "vitest";
import { z } from "zod";

import { resolveDictionaryTrustDefaults } from "./data-dictionary-trust";
import { cliBoolean } from "./schema-helpers";

describe("save-data-dictionary-entry schema", () => {
  it("parses CLI boolean strings explicitly", async () => {
    const schema = z.object({
      approved: cliBoolean.optional(),
      aiGenerated: cliBoolean.optional(),
    });
    const result = await schema["~standard"].validate({
      approved: "true",
      aiGenerated: "false",
    });

    expect(result).toEqual({
      value: {
        approved: true,
        aiGenerated: false,
      },
    });
  });

  it("defaults human-authored entries to approved", () => {
    expect(resolveDictionaryTrustDefaults({})).toEqual({
      approved: true,
      aiGenerated: false,
    });
  });

  it("defaults AI-generated entries to unapproved suggestions", () => {
    expect(resolveDictionaryTrustDefaults({ aiGenerated: true })).toEqual({
      approved: false,
      aiGenerated: true,
    });
  });

  it("preserves existing review state unless explicitly changed", () => {
    expect(
      resolveDictionaryTrustDefaults(
        {},
        { approved: false, aiGenerated: true },
      ),
    ).toEqual({
      approved: false,
      aiGenerated: true,
    });
    expect(
      resolveDictionaryTrustDefaults(
        { approved: true },
        { approved: false, aiGenerated: true },
      ),
    ).toEqual({
      approved: true,
      aiGenerated: true,
    });
  });
});
