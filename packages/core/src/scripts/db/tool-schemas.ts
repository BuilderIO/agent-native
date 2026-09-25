import type { ActionTool } from "../../agent/types.js";

export function dbExecToolParameters(): NonNullable<ActionTool["parameters"]> {
  return {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description:
          "Single INSERT / UPDATE / DELETE / REPLACE statement. Use parameterized placeholders (?) where possible.",
      },
      args: {
        type: "string",
        description:
          'Optional JSON array of positional bind args for `sql`. Example: \'["published","form-123"]\'',
      },
      statements: {
        type: "string",
        description:
          'Optional JSON array of write statements to execute in one transaction. Prefer this over multiple db-exec calls. Example: \'[{"sql":"INSERT INTO notes (id,title) VALUES (?,?)","args":["n1","One"]},{"sql":"UPDATE counters SET value = value + 1 WHERE key = ?","args":["notes"]}]\'',
      },
      format: {
        type: "string",
        description: 'Output format: "json" or "text" (default: text)',
        enum: ["json", "text"],
      },
    },
    additionalProperties: false,
    oneOf: [{ required: ["sql"] }, { required: ["statements"] }],
  };
}
