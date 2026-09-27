import { z } from "zod";

const queryBoolean = z.union([
  z.boolean(),
  z.enum(["true", "false", "1", "0"]),
]);

export const getDesignSchema = z.object({
  id: z.string().describe("Design ID"),
  fileId: z.string().min(1).optional().describe("Read one design file by ID"),
  includeFileContent: queryBoolean
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value === true || value === "true" || value === "1",
    )
    .describe("Set false to return file metadata without HTML contents"),
  reviewPreview: queryBoolean
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value === true || value === "true" || value === "1",
    )
    .describe(
      "Human Review only: read a design in the current organization. Requires an organization owner or admin.",
    ),
});
