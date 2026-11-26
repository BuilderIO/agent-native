import {
  readAppState,
  writeAppState,
} from "../application-state/script-helpers.js";
import { listLabs } from "./registry.js";
import type { UserLabStateResult } from "./store.js";

export const LABS_APP_STATE_KEY = "labs";

/**
 * Mirrors which Labs are on into application_state so the agent sees them
 * without a tool call. Unreadable labs are listed apart, not counted as off.
 */
export async function syncLabsAppState(
  states: Record<string, UserLabStateResult>,
  showAll: boolean,
): Promise<void> {
  const entries = listLabs().map(({ key }) => ({
    key,
    state: Object.hasOwn(states, key) ? states[key] : undefined,
  }));
  const lists = {
    showAll,
    on: entries
      .filter((e) => e.state && "enabled" in e.state && e.state.enabled)
      .map((e) => e.key),
    off: entries
      .filter((e) => e.state && "enabled" in e.state && !e.state.enabled)
      .map((e) => e.key),
    unreadable: entries
      .filter((e) => e.state && "error" in e.state)
      .map((e) => e.key),
  };
  const current = await readAppState(LABS_APP_STATE_KEY);
  if (current && JSON.stringify(current) === JSON.stringify(lists)) return;
  await writeAppState(LABS_APP_STATE_KEY, lists);
}
