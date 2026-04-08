import type { ActionTool } from "./agent/types.js";

/** HTTP exposure config for an action. */
export interface ActionHttpConfig {
  /** HTTP method. Default: "POST". Use "GET" for read-only actions. */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Override route path under /_agent-native/actions/. Default: action filename. */
  path?: string;
}

/** Schema definition for a single action parameter. */
export interface ParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
}

/** Infer runtime parameter types from a parameter schema map. */
type InferParams<T extends Record<string, ParameterSchema> | undefined> =
  T extends Record<string, ParameterSchema>
    ? { [K in keyof T]?: string }
    : Record<string, string>;

interface DefineActionOptions<
  TParams extends Record<string, ParameterSchema> | undefined =
    | Record<string, ParameterSchema>
    | undefined,
  TReturn = any,
> {
  description: string;
  /** Flat map of parameter names to their schema. Automatically wrapped in `{ type: "object", properties: ... }`. */
  parameters?: TParams;
  run: (args: InferParams<TParams>) => Promise<TReturn> | TReturn;
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
 * The return type of `run` is captured generically, enabling end-to-end type
 * safety when the generated action type registry is present. The client hooks
 * (`useActionQuery`, `useActionMutation`) automatically infer the correct
 * return and parameter types from the registry.
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
 *     return events; // type is inferred and flows to the client
 *   },
 * });
 * ```
 */
export function defineAction<
  TParams extends Record<string, ParameterSchema> | undefined,
  TReturn,
>(options: DefineActionOptions<TParams, TReturn>) {
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
