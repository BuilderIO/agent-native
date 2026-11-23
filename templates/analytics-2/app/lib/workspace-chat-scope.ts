export const WORKSPACE_CHAT_APP_ID = "analytics-2";

/** The same persisted namespace is used by the chat transport and app actions. */
export function workspaceChatScope(
  orgId: string,
  appId = WORKSPACE_CHAT_APP_ID,
) {
  const organization = orgId.trim();
  const application = appId.trim();
  if (!organization || !application)
    throw new Error("Select a workspace to continue.");
  const id = `${encodeURIComponent(application)}:org:${encodeURIComponent(organization)}`;
  if (id.length > 256)
    throw new Error(
      "The workspace identifier is too long for a conversation scope.",
    );
  return { type: "workspace-app", id } as const;
}
