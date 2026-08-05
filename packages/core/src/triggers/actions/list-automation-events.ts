import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { listEvents } from "../../event-bus/index.js";

export interface AutomationEventActionItem {
  name: string;
  description: string;
  payloadSchema: Record<string, unknown> | null;
  example: Record<string, unknown> | null;
}

function payloadJsonSchema(
  schema: StandardSchemaV1,
): Record<string, unknown> | null {
  const standard = schema["~standard"] as StandardSchemaV1["~standard"] & {
    jsonSchema?: {
      input?: (options: { target: "draft-07" }) => unknown;
    };
  };
  if (standard.jsonSchema?.input) {
    const converted = standard.jsonSchema.input({ target: "draft-07" });
    if (
      converted &&
      typeof converted === "object" &&
      !Array.isArray(converted)
    ) {
      return converted as Record<string, unknown>;
    }
    return null;
  }

  return z.toJSONSchema(schema as z.ZodType, {
    io: "input",
    target: "draft-7",
  }) as Record<string, unknown>;
}

export default defineAction({
  description:
    "List registered events and their structured payload schemas for the automation editor.",
  agentTool: false,
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (): Promise<AutomationEventActionItem[]> =>
    listEvents().map((event) => ({
      name: event.name,
      description: event.description,
      payloadSchema: payloadJsonSchema(event.payloadSchema),
      example: event.example ?? null,
    })),
});
