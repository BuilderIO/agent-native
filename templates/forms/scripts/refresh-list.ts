/**
 * Trigger a UI refresh by writing and deleting a refresh signal.
 *
 * Usage:
 *   pnpm script refresh-list
 */

import {
  writeAppState,
  deleteAppState,
} from "@agent-native/core/application-state";

export default async function main() {
  await writeAppState("refresh-trigger", { ts: Date.now() });
  await deleteAppState("refresh-trigger");
  console.log("UI refresh triggered.");
}
