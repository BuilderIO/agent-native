import type { ActionTool } from "./agent/types.js";

/** HTTP exposure config for an action. */
export interface ActionHttpConfig {
  /** HTTP method. Default: "POST". Use "GET" for read-only actions. */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Override route path under /_agent-native/actions/. Default: action filename. */
  path?: string;
}

interface DefineActionOptions {
  description: string;
  /** Flat map of parameter names to their schema. Automatically wrapped in `{ type: "object", properties: ... }`. */
  parameters?: Record<
    string,
    { type: string; description?: string; enum?: string[] }
  >;
  run: (args: Record<string, string>) => Promise<any> | any;
  /**
   * HTTP exposure config. Controls whether this action is auto-mounted as an API endpoint.
   * - Omitted → auto-exposed with method inferred from action name
   * - `false` → agent-only, never exposed as HTTP
   * - `{ method: "GET" }` → explicit override
   */
  http?: ActionHttpConfig | false;
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
    ...(options.http !== undefined ? { http: options.http } : {}),
  };
}
