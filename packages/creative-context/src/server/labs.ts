import { fail } from "@agent-native/core/action";
import type { DbExec } from "@agent-native/core/db";
import { getUserLabs } from "@agent-native/core/labs/server";
import type { ActionEntry } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import { CREATIVE_CONTEXT_LIBRARY_LAB } from "../labs.js";
import { getCreativeContext } from "./context.js";

export async function isCreativeContextLabAvailable(
  userEmail: string | undefined,
  labKey = CREATIVE_CONTEXT_LIBRARY_LAB.key,
  options: { transaction?: DbExec } = {},
): Promise<boolean> {
  if (!userEmail) return false;
  const labs = options.transaction
    ? await getUserLabs(userEmail, options)
    : await getUserLabs(userEmail);
  return labs[labKey] === true;
}

export async function assertCreativeContextLabEnabled(
  userEmail = getRequestUserEmail(),
): Promise<void> {
  if (
    !(await isCreativeContextLabAvailable(
      userEmail,
      getCreativeContext().labKey,
    ))
  ) {
    fail("Creative Context is disabled in Labs", {
      errorCode: "creative_context_disabled",
      statusCode: 404,
    });
  }
}

const creativeContextActionAvailable: NonNullable<
  ActionEntry["agentDiscoveryAvailable"]
> = (context) =>
  isCreativeContextLabAvailable(
    context?.userEmail ?? getRequestUserEmail(),
    getCreativeContext().labKey,
  );

function gateCreativeContextAction(action: ActionEntry): ActionEntry {
  return {
    ...action,
    agentDiscoveryAvailable: creativeContextActionAvailable,
    async run(args, context) {
      await assertCreativeContextLabEnabled(
        context?.userEmail ?? getRequestUserEmail(),
      );
      return action.run(args, context);
    },
  };
}

export function gateCreativeContextActions(
  actions: Record<string, ActionEntry>,
): Record<string, ActionEntry> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, action]) => [
      name,
      name === "process-context-purge"
        ? action
        : gateCreativeContextAction(action),
    ]),
  );
}
