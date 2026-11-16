/**
 * Hosts that serve Notion's uploaded files through signed links. Notion's
 * docs give those links an hour; a page that keeps one shows a broken image
 * or a dead download once it lapses.
 */
const NOTION_FILE_HOSTS = new Set([
  "prod-files-secure.s3.us-west-2.amazonaws.com",
  "s3.us-west-2.amazonaws.com",
  "file.notion.so",
  "file.notion.com",
]);

/**
 * Whether `url` is one of Notion's signed file links, which stop working
 * within hours, so an import uploads the file it names instead of linking it.
 * Other remote links stay linked as written.
 */
export function isExpiringFileUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return false;
  if (!NOTION_FILE_HOSTS.has(parsed.hostname.toLowerCase())) return false;
  if (
    parsed.hostname === "s3.us-west-2.amazonaws.com" &&
    !parsed.pathname.startsWith("/secure.notion-static.com/")
  ) {
    return false;
  }
  const params = new Set(
    [...parsed.searchParams.keys()].map((key) => key.toLowerCase()),
  );
  return (
    params.has("x-amz-expires") ||
    params.has("x-amz-signature") ||
    (params.has("expirationtimestamp") && params.has("signature"))
  );
}

/** The file name a signed link names, for the import report. */
export function expiringFileLabel(url: string): string {
  if (!URL.canParse(url)) return url.slice(0, 80);
  const name = new URL(url).pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(name) || new URL(url).hostname;
  } catch {
    return name || new URL(url).hostname;
  }
}
