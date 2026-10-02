/**
 * The chat thread a failure happened in, when its capture named one
 * (`extra.failureContext.threadUrl`). Events are client-submitted, so only an
 * http(s) address is returned; the caller shows the address itself as the link
 * text so a planted one cannot hide where it points.
 */
export function failureThreadUrl(
  extra: Record<string, unknown> | undefined,
): string | undefined {
  const failure = extra?.failureContext as { threadUrl?: unknown } | undefined;
  const url = failure?.threadUrl;
  if (typeof url !== "string" || !URL.canParse(url)) return undefined;
  const { protocol } = new URL(url);
  return protocol === "https:" || protocol === "http:" ? url : undefined;
}
