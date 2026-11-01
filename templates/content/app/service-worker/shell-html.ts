import { IMMUTABLE_ASSET_PATH } from "./shell-contract";

const REACT_ROUTER_MANIFEST_URL = /\/assets\/manifest-([A-Za-z0-9_-]{8})\.js/;
const QUOTED_ASSET_PATH = /["'](\/assets\/[^"'?#\s]+)["']/g;

/** The React Router manifest version the HTML boots, which names its build. */
export function shellBuildVersion(html: string): string | undefined {
  return REACT_ROUTER_MANIFEST_URL.exec(html)?.[1];
}

/** Content-hashed files the HTML loads directly: preloads, styles, entry. */
export function shellAssetReferences(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(QUOTED_ASSET_PATH)) {
    const [, assetPath] = match;
    if (assetPath && IMMUTABLE_ASSET_PATH.test(assetPath)) found.add(assetPath);
  }
  return [...found];
}

/**
 * Whether a response is safe to keep and hand to anyone who opens the same
 * URL: a plain 200 the server marked public for shared caches, which it only
 * does for the impersonal shell (SSR never reads the session). Anything
 * private, uncacheable or varying by cookie stays out.
 */
export function isShareableShellResponse(response: Response): boolean {
  if (response.status !== 200 || response.redirected) return false;
  if (response.type !== "basic" && response.type !== "default") return false;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) return false;
  const cacheControl = (response.headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")
    .map((directive) => directive.trim().split("=", 1).join(""));
  if (!cacheControl.includes("public")) return false;
  if (
    cacheControl.some((directive) =>
      ["private", "no-store", "no-cache"].includes(directive),
    )
  ) {
    return false;
  }
  const vary = (response.headers.get("vary") ?? "")
    .toLowerCase()
    .split(",")
    .map((name) => name.trim());
  return !vary.some((name) => ["*", "cookie", "authorization"].includes(name));
}
