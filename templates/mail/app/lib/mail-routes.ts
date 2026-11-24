import { appPath } from "@agent-native/core/client/api-path";
import { isKnownMailView } from "@shared/mail-routes";

export function mailThreadHref(
  view: string,
  threadId: string,
  searchParams: URLSearchParams,
  accountEmail?: string,
) {
  const params = new URLSearchParams(searchParams);
  if (accountEmail) params.set("accountEmail", accountEmail);
  else params.delete("accountEmail");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `/${view}/${threadId}${suffix}`;
}

export function mailThreadUrl(threadId: string, accountEmail?: string) {
  const href = mailThreadHref(
    "inbox",
    threadId,
    new URLSearchParams(),
    accountEmail,
  );
  return window.location.origin + appPath(href);
}

export function mailViewHasThreadLinks(view: string | undefined) {
  return isKnownMailView(view) && view !== "drafts" && view !== "scheduled";
}

export function mailViewHref(view: string, searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.delete("accountEmail");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `/${view}${suffix}`;
}
