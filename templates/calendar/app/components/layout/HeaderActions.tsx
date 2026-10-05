import { AgentToggleButton } from "@agent-native/toolkit/app/chat";
import { NotificationsBell } from "@agent-native/toolkit/app/notifications";

/**
 * Trailing controls for every Calendar header. The bell is the only place
 * notifications sent by the agent or an automation appear in Calendar, so a
 * header that drops it makes "notify me here" deliver nowhere.
 */
export function HeaderActions() {
  return (
    <>
      <NotificationsBell />
      <AgentToggleButton />
    </>
  );
}
