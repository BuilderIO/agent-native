/**
 * Search Console addresses a property by the exact string it was created
 * with: `sc-domain:example.com` for a Domain property, or the full URL with
 * its trailing slash for a URL-prefix property. Anything else reaches the API
 * as a property nobody has access to, so it fails as "no access" instead of
 * as a typo.
 */
export type SearchConsolePropertyProblem =
  | { kind: "bare_domain"; suggestion: string }
  | { kind: "invalid_domain"; suggestion?: string }
  | { kind: "missing_trailing_slash"; suggestion: string }
  | { kind: "unrecognized" };

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i;

function hostOf(value: string): string | null {
  const url = URL.canParse(value)
    ? new URL(value)
    : URL.canParse(`https://${value}`)
      ? new URL(`https://${value}`)
      : null;
  return url && HOSTNAME.test(url.hostname) ? url.hostname.toLowerCase() : null;
}

export function searchConsolePropertyProblem(
  siteUrl: string,
): SearchConsolePropertyProblem | null {
  const value = siteUrl.trim();
  if (value.toLowerCase().startsWith("sc-domain:")) {
    const domain = value.slice("sc-domain:".length);
    if (HOSTNAME.test(domain)) return null;
    const host = hostOf(domain);
    return host
      ? { kind: "invalid_domain", suggestion: `sc-domain:${host}` }
      : { kind: "invalid_domain" };
  }
  if (/^https?:\/\//i.test(value)) {
    if (!URL.canParse(value) || !hostOf(value)) return { kind: "unrecognized" };
    return value.endsWith("/")
      ? null
      : { kind: "missing_trailing_slash", suggestion: `${value}/` };
  }
  const host = /^[^/\s:]+$/.test(value) ? hostOf(value) : null;
  return host
    ? { kind: "bare_domain", suggestion: `sc-domain:${host}` }
    : { kind: "unrecognized" };
}

/** The English explanation agents and the action's validation error show. */
export function searchConsolePropertyMessage(
  siteUrl: string,
  problem: SearchConsolePropertyProblem,
): string {
  const forms =
    "Use sc-domain:example.com for a Domain property, or the full URL-prefix property ending in /, such as https://www.example.com/.";
  switch (problem.kind) {
    case "bare_domain":
      return `"${siteUrl}" isn't a Search Console property. For a Domain property, use ${problem.suggestion}.`;
    case "invalid_domain":
      return problem.suggestion
        ? `A Domain property is sc-domain: followed by the domain only, with no https:// or path: ${problem.suggestion}.`
        : `"${siteUrl}" isn't a valid Domain property. ${forms}`;
    case "missing_trailing_slash":
      return `URL-prefix properties end in /. Use ${problem.suggestion}.`;
    case "unrecognized":
      return `"${siteUrl}" isn't a Search Console property. ${forms}`;
  }
}
