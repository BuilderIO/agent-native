import type { CollabUser } from "@agent-native/core/client/collab";
import { DEFAULT_AGENT_IDENTITY } from "@agent-native/toolkit/collab-ui";

export function getPassiveSlidePresenceUsers(
  users: CollabUser[],
  agentActive: boolean | undefined,
): CollabUser[] {
  if (!agentActive) return users;

  return users.filter(
    (user) => user.email.trim().toLowerCase() !== DEFAULT_AGENT_IDENTITY.email,
  );
}
