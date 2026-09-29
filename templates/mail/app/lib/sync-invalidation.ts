type MailSyncEvent = { source?: string; key?: string };

export function shouldInvalidateMailQueryForActionEvent(
  query: { queryKey: readonly unknown[] },
  events?: readonly MailSyncEvent[],
): boolean {
  const queryKey = query.queryKey;
  const actionEvents = events?.filter((event) => event.source === "action");

  if (actionEvents?.length) {
    const actionKeys = new Set(actionEvents.map((event) => event.key));
    const hasOtherAction = [...actionKeys].some(
      (key) => key !== "sync-inbox" && key !== "update-mail-preferences",
    );
    if (hasOtherAction) {
      return queryKey[0] === "action";
    }

    return (
      actionKeys.has("sync-inbox") &&
      ((queryKey[0] === "action" &&
        (queryKey[1] === "list-inbox-threads" ||
          queryKey[1] === "list-labels")) ||
        queryKey[0] === "mail-inbox-overview")
    );
  }

  if (events?.length && events.every((event) => event.source === "settings")) {
    return false;
  }

  return queryKey[0] === "action";
}
