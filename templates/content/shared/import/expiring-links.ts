const NOTION_FILE_HOSTS = new Set([
  "prod-files-secure.s3.us-west-2.amazonaws.com",
  "s3.us-west-2.amazonaws.com",
  "file.notion.so",
  "file.notion.com",
]);

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

export function expiringFileLabel(url: string): string {
  if (!URL.canParse(url)) return url.slice(0, 80);
  const name = new URL(url).pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(name) || new URL(url).hostname;
  } catch {
    return name || new URL(url).hostname;
  }
}

export function withoutQuery(url: string): string {
  if (!URL.canParse(url)) return url;
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}
