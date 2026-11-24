import { appPath } from "@agent-native/core/client/api-path";

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

export function mailViewHref(view: string, searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.delete("accountEmail");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `/${view}${suffix}`;
}
