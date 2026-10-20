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

export function mailViewHref(view: string, searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.delete("accountEmail");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `/${view}${suffix}`;
}
