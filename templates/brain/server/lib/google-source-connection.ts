import { fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";

import type { GoogleSourceProvider } from "../../shared/google-source-config.js";

export function requirePersonalGoogleSourceOwner(
  ownerEmail = getRequestUserEmail(),
) {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!email || email !== ownerEmail?.trim().toLowerCase()) {
    fail(
      "Only the source owner can sync or configure a personal Google source.",
      { errorCode: "google_source_owner_required" },
    );
  }
  return email;
}

export async function requirePersonalGoogleConnection(
  provider: GoogleSourceProvider,
  config: Record<string, unknown>,
  ownerEmail = getRequestUserEmail(),
) {
  const email = requirePersonalGoogleSourceOwner(ownerEmail);
  const connectionId =
    typeof config.workspaceConnectionId === "string"
      ? config.workspaceConnectionId.trim()
      : "";
  if (!connectionId) {
    fail("Select a granted Google workspace connection for this source.", {
      errorCode: "google_source_connection_required",
    });
  }
  const result = await resolveWorkspaceConnectionForApp({
    appId: "brain",
    provider,
    connectionId,
    connectionOwnerEmail: email,
    requireConnected: true,
  });
  const connection = result.connection;
  if (
    !result.available ||
    !connection ||
    connection.ownerEmail.trim().toLowerCase() !== email ||
    !connection.accountId
  ) {
    fail(
      "The selected Google connection must be connected, granted to Brain, and owned by you.",
      {
        errorCode: "google_source_connection_unavailable",
      },
    );
  }
  return {
    connectionId: connection.id,
    accountId: connection.accountId,
    ownerEmail: email,
  };
}
