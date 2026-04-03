import type { ActionTool } from "./agent/types.js";

interface DefineActionOptions {
  description: string;
  /** Flat map of parameter names to their schema. Automatically wrapped in `{ type: "object", properties: ... }`. */
  parameters?: Record<
    string,
    { type: string; description?: string; enum?: string[] }
  >;
  run: (args: Record<string, string>) => Promise<string> | string;
}

/**
 * Define an agent action. Place in `actions/` directory -- auto-discovered by the framework.
 *
 * ```ts
 * // actions/list-events.ts
 * import { defineAction } from "@agent-native/core";
 *
 * export default defineAction({
 *   description: "List calendar events",
 *   parameters: {
 *     from: { type: "string", description: "Start date" },
 *     to: { type: "string", description: "End date" },
 *   },
 *   run: async (args) => {
 *     const events = await fetchEvents(args.from, args.to);
 *     return JSON.stringify(events, null, 2);
 *   },
 * });
 * ```
 */
export function defineAction(options: DefineActionOptions) {
  return {
    tool: {
      description: options.description,
      parameters: options.parameters
        ? {
            type: "object" as const,
            properties: options.parameters,
          }
        : undefined,
    },
    run: options.run,
  };
}
