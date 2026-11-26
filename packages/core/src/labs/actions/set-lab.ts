import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { syncLabsAppState } from "../app-state.js";
import { getLabDefinition } from "../registry.js";
import {
  getUserLabsShowAll,
  setUserLabStates,
  type UserLabStateResult,
} from "../store.js";

const schema = z.object({
  key: z.string().describe("The registered lab key to change."),
  enabled: z
    .boolean()
    .nullable()
    .describe(
      "Whether the current user opts into it, or null to clear their choice so the lab follows its default again.",
    ),
});

export default defineAction({
  description:
    "Opt the current user into or out of one registered lab, or clear their choice. Unset preferences inherit declared legacy flags or use the app-defined default; labs may expose new or unstable features.",
  schema,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  mcpTool: false,
  run: async (args, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    if (!getLabDefinition(args.key)) {
      fail(`Unknown lab: ${args.key}`, { statusCode: 404 });
    }
    const states = await setUserLabStates(email, args.key, args.enabled, {
      orgId: ctx?.orgId,
    });
    await syncLabsAppState(states, await getUserLabsShowAll(email));
    const state = Object.hasOwn(states, args.key)
      ? states[args.key]
      : undefined;
    // A cleared choice falls back to the lab's legacy flags, which may be
    // unreadable right now; the clear is saved all the same, and the state
    // says so, so it reads off like any unreadable lab.
    if (args.enabled === null && state && "error" in state) {
      return {
        key: args.key,
        enabled: false,
        values: readable(states),
        states,
      };
    }
    if (!state || "error" in state) {
      // guard:allow-bare-error — invariant: a successful setter must return its valid target state
      throw new Error(
        `Could not read saved lab state after updating ${args.key}`,
      );
    }
    return {
      key: args.key,
      enabled: state.enabled,
      values: readable(states),
      states,
    };
  },
});

function readable(states: Record<string, UserLabStateResult>) {
  return Object.fromEntries(
    Object.entries(states).flatMap(([key, value]) =>
      "error" in value ? [] : [[key, value.enabled]],
    ),
  );
}
