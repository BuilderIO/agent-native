import { writeAppState } from "@agent-native/core/application-state";

export default async function () {
  // Write a dummy state change to trigger UI invalidation via SSE
  await writeAppState("refresh-trigger", { timestamp: Date.now() });
  return "Refreshed. The UI will update shortly.";
}
