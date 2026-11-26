import { scrubUrl } from "@agent-native/core/client/url-scrub";

// Fields a caller can use to name a page: a path field holds a pathname, a URL
// field a whole URL. The path stays as the sender wrote it. Only the sender
// knows its routes, and an app such as the docs site keeps real slugs on
// purpose, so ingest guesses no route template; a client that has its router
// manifest already sends one.
const URL_FIELDS = [
  "url",
  "href",
  "referrer",
  "path",
  "pathname",
  "entry_path",
  "landing_path",
  "first_touch_path",
  "last_touch_path",
  "site_landing_path",
  "last_touch_site_path",
] as const;

function scrubSearch(search: string): string | undefined {
  return scrubUrl(`/${search}`)?.slice(1);
}

function scrubFields(record: Record<string, unknown>): Record<string, unknown> {
  let scrubbed: Record<string, unknown> | undefined;
  const set = (key: string, value: string | undefined) => {
    if (value === undefined || value === record[key]) return;
    scrubbed ??= { ...record };
    scrubbed[key] = value;
  };
  for (const key of URL_FIELDS) {
    const value = record[key];
    if (typeof value === "string") set(key, scrubUrl(value));
  }
  const search = record.search;
  if (typeof search === "string") set("search", scrubSearch(search));
  return scrubbed ?? record;
}

/**
 * Event properties or context with every URL-shaped field scrubbed, including a
 * Segment-style `context.page`. Callers other than this app's own bundles send
 * these as they like, so ingest cannot rely on the browser having scrubbed them.
 */
export function scrubEventUrlFields(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const scrubbed = scrubFields(record);
  const page = scrubbed.page;
  if (!page || typeof page !== "object" || Array.isArray(page)) return scrubbed;
  const scrubbedPage = scrubFields(page as Record<string, unknown>);
  return scrubbedPage === page ? scrubbed : { ...scrubbed, page: scrubbedPage };
}
