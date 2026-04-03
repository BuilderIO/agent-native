/**
 * Google Calendar sync is no longer needed.
 *
 * Events are now read directly from the Google Calendar API.
 * Use `list-events` to view events, and `create-event` to create them.
 *
 * This script is kept as a stub for backward compatibility.
 */

import { agentChat } from "@agent-native/core";

export default async function main(_args: string[]) {
  console.log(
    "Google Calendar sync is no longer needed. Events are read directly from the Google Calendar API.",
  );
  console.log("");
  console.log("Use these scripts instead:");
  console.log("  pnpm action list-events --from 2026-01-01 --to 2026-12-31");
  console.log(
    '  pnpm action create-event --title "Meeting" --start ... --end ...',
  );
  console.log("  pnpm action check-availability --date 2026-03-15");

  agentChat.submit(
    "The sync-google-calendar script is no longer needed. Events are now read directly from the Google Calendar API. Use list-events, create-event, or check-availability instead.",
  );
}
