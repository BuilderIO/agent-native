
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

export const MCP_PROVIDER_ENDPOINTS: Record<string, string> = {
  amplitude: "https://mcp.amplitude.com/mcp",
  apollo: "https://mcp.apollo.io/mcp",
  asana: "https://mcp.asana.com/v2/mcp",
  atlassian: "https://mcp.atlassian.com/v1/mcp/authv2",
  box: "https://mcp.box.com",
  "builder-cms": "https://mcp.builder.io/mcp/publish",
  canva: "https://mcp.canva.com/mcp",
  cloudflare: "https://mcp.cloudflare.com/mcp",
  "common-room": "https://mcp.commonroom.io/mcp",
  context7: "https://mcp.context7.com/mcp",
  exa: "https://mcp.exa.ai/mcp",
  figma: "https://mcp.figma.com/mcp",
  fullstory: "https://api.fullstory.com/mcp/fullstory",
  github: "https://api.githubcopilot.com/mcp/",
  gitlab: "https://gitlab.com/api/v4/mcp",
  gong: "https://mcp.gong.io/mcp",
  grafana: "https://mcp.grafana.com/mcp",
  granola: "https://mcp.granola.ai/mcp",
  hubspot: "https://mcp.hubspot.com",
  intercom: "https://mcp.intercom.com/mcp",
  linear: "https://mcp.linear.app/mcp",
  monday: "https://mcp.monday.com/mcp",
  neon: "https://mcp.neon.tech/sse",
  netlify: "https://netlify-mcp.netlify.app/mcp",
  notion: "https://mcp.notion.com/mcp",
  paypal: "https://mcp.paypal.com/sse",
  pylon: "https://mcp.usepylon.com/",
  semgrep: "https://mcp.semgrep.ai/mcp",
  sentry: "https://mcp.sentry.dev/mcp",
  slack: "https://mcp.slack.com/mcp",
  stripe: "https://mcp.stripe.com",
  supabase: "https://mcp.supabase.com/mcp",
  vercel: "https://mcp.vercel.com",
  webflow: "https://mcp.webflow.com/mcp",
  zapier: "https://mcp.zapier.com/api/v1/connect",
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

export function hasMcpProviderMatchRules(providerId: string): boolean {
  return Boolean(
    MCP_PROVIDER_ENDPOINTS[providerId] || MCP_LINK_HOSTS[providerId]?.length,
  );
}

export function mcpServerUrlMatchesProvider(
  providerId: string,
  serverUrl: string,
): boolean | null {
  const endpoint = MCP_PROVIDER_ENDPOINTS[providerId];
  if (endpoint && normalizeMcpUrl(endpoint) === normalizeMcpUrl(serverUrl)) {
    return true;
  }

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
