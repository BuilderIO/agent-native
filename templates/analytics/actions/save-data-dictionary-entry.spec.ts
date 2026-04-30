import { describe, expect, it } from "vitest";
import { z } from "zod";
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
});
