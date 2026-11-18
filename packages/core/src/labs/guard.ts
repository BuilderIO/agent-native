import { fail } from "../action.js";
import type { LabReference } from "../client/labs/use-lab.js";
import { labsCaller } from "./caller.js";
import { getUserLabEnabled } from "./store.js";

/**
 * Server-side guard for actions only a Lab uses. Hiding the UI is not
 * enforcement; call this first in the action's `run`.
 */
export async function assertLabEnabled(
  lab: LabReference,
  ctx: unknown,
): Promise<void> {
  const { email, scope } = labsCaller(ctx);
  const key = typeof lab === "string" ? lab : lab.key;
  if (!(await getUserLabEnabled(email, key, scope))) {
    fail(
      `${key} is a Lab and isn't turned on. Turn it on in Settings › Labs.`,
      {
        statusCode: 403,
      },
    );
  }
}
