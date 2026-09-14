/**
 * Provider host matching shared by the client integration catalog and the
 * server-side connected-provider lookup.
 *
 * This lives outside `client/resources/mcp-integration-catalog.ts` because that
 * module imports the inlined base64 logo table; pulling it into a server path
 * would put megabytes of icon data in the deployed bundle.
 */

export const MCP_LINK_HOSTS: Record<string, string[]> = {
  amplitude: ["amplitude.com"],
  apollo: ["apollo.io"],
  "common-room": ["commonroom.io"],
  context7: ["context7.com"],
  exa: ["exa.ai"],
  sentry: ["sentry.io", "sentry.dev"],
  gong: ["gong.io"],
  grafana: ["grafana.com", "grafana.net"],
  "builder-cms": ["builder.io"],
  sigma: ["sigmacomputing.com"],
  notion: ["notion.com", "notion.so", "notion.site"],
  granola: ["granola.ai"],
  semgrep: ["semgrep.dev", "semgrep.com"],
  canva: ["canva.com", "canva.ai"],
  figma: ["figma.com"],
  linear: ["linear.app"],
  atlassian: ["atlassian.com", "atlassian.net", "jira.com", "confluence.com"],
  supabase: ["supabase.com"],
  neon: ["neon.tech"],
  stripe: ["stripe.com"],
  cloudflare: ["cloudflare.com"],
  github: ["github.com", "github.dev"],
  gitlab: ["gitlab.com"],
  slack: ["slack.com"],
  asana: ["asana.com"],
  hubspot: ["hubspot.com"],
  intercom: ["intercom.com"],
  pylon: ["usepylon.com", "pylon.com"],
  monday: ["monday.com"],
  webflow: ["webflow.com"],
  paypal: ["paypal.com"],
  box: ["box.com"],
  netlify: ["netlify.com"],
  vercel: ["vercel.com"],
  zapier: ["zapier.com"],
};

export function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function normalizeMcpUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
    // coercion-ok: a non-URL string is compared verbatim after trimming.
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

/**
 * True when a saved remote MCP server URL belongs to `providerId`.
 *
 * Returns `null` — not `false` — when `serverUrl` cannot be parsed, so callers
 * can tell "this row is for another provider" apart from "this row is corrupt".
 */
export function mcpServerUrlMatchesProvider(
  providerId: string,
  serverUrl: string,
): boolean | null {
  const hosts = MCP_LINK_HOSTS[providerId];
  if (!hosts?.length) return false;

  let hostname: string;
  try {
    hostname = new URL(serverUrl.trim()).hostname.toLowerCase();
    // A URL this function cannot parse is not the same answer as a URL that
    // belongs to another provider, so the two get different return values.
    // coercion-ok: null is the typed "unparseable" answer, not a false match.
  } catch {
    return null;
  }

  return hosts.some((domain) => hostMatches(hostname, domain));
}
