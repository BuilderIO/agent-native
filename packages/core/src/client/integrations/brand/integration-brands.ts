/**
 * Brand data for integration and channel detail pages: the hero tint, who
 * builds the service, and the example prompts the hero offers. Keyed by
 * catalog id (channels by their channel id). Brand names aren't translated;
 * prompts are catalog keys.
 */
export interface IntegrationBrand {
  /** Tints the hero. Without one the hero stays neutral. */
  hue?: string;
  developer: string;
  /** Catalog keys for the hero's example prompts, in order. */
  prompts?: readonly string[];
  /** Catalog key for where to get the token, under the access token field. */
  tokenHint?: string;
  /**
   * The provider only admits clients it has approved, and it hasn't approved
   * Agent-Native, so the page offers no connect action. The catalog's
   * `client-restricted` can't say this alone: Canva is restricted too, but its
   * OAuth works for any client that allows its domains.
   */
  unavailable?: boolean;
}

const DETAIL_KEY = "agentChat.settingsShell.integrationDetail";
const PROMPT_KEY = `${DETAIL_KEY}.prompt`;

function prompts(id: string): readonly string[] {
  return [1, 2, 3].map((n) => `${PROMPT_KEY}.${id}.${n}`);
}

const BRANDS: Readonly<Record<string, IntegrationBrand>> = {
  github: {
    hue: "#6e7681",
    developer: "GitHub",
    prompts: prompts("github"),
    tokenHint: `${DETAIL_KEY}.tokenHint.github`,
  },
  gitlab: {
    hue: "#fc6d26",
    developer: "GitLab",
    prompts: prompts("gitlab"),
  },
  linear: {
    hue: "#5e6ad2",
    developer: "Linear",
    prompts: prompts("linear"),
  },
  atlassian: {
    hue: "#0c66e4",
    developer: "Atlassian",
    prompts: prompts("atlassian"),
  },
  sentry: {
    hue: "#7553ff",
    developer: "Sentry",
    prompts: prompts("sentry"),
    tokenHint: `${DETAIL_KEY}.tokenHint.sentry`,
  },
  semgrep: {
    hue: "#22a06b",
    developer: "Semgrep",
    prompts: prompts("semgrep"),
  },
  vercel: {
    unavailable: true,
    hue: "#6e7681",
    developer: "Vercel",
    prompts: prompts("vercel"),
  },
  netlify: {
    hue: "#05bdba",
    developer: "Netlify",
    prompts: prompts("netlify"),
  },
  cloudflare: {
    hue: "#f38020",
    developer: "Cloudflare",
    prompts: prompts("cloudflare"),
  },
  supabase: {
    hue: "#3ecf8e",
    developer: "Supabase",
    prompts: prompts("supabase"),
  },
  neon: {
    hue: "#00e599",
    developer: "Neon",
    prompts: prompts("neon"),
  },
  grafana: {
    hue: "#f46800",
    developer: "Grafana Labs",
    prompts: prompts("grafana"),
  },
  context7: {
    hue: "#10b981",
    developer: "Context7",
    prompts: prompts("context7"),
  },
  figma: {
    hue: "#a259ff",
    developer: "Figma",
    prompts: prompts("figma"),
    tokenHint: `${DETAIL_KEY}.tokenHint.figma`,
  },
  canva: {
    hue: "#7d2ae8",
    developer: "Canva",
    prompts: prompts("canva"),
  },
  webflow: {
    hue: "#146ef5",
    developer: "Webflow",
    prompts: prompts("webflow"),
  },
  notion: {
    hue: "#6e7681",
    developer: "Notion",
    prompts: prompts("notion"),
  },
  asana: {
    hue: "#f06a6a",
    developer: "Asana",
    prompts: prompts("asana"),
  },
  monday: {
    hue: "#ff3d57",
    developer: "monday.com",
    prompts: prompts("monday"),
  },
  box: {
    hue: "#0061d5",
    developer: "Box",
    prompts: prompts("box"),
  },
  granola: {
    hue: "#7cb342",
    developer: "Granola",
    prompts: prompts("granola"),
  },
  zapier: {
    hue: "#ff4f00",
    developer: "Zapier",
    prompts: prompts("zapier"),
    tokenHint: `${DETAIL_KEY}.tokenHint.zapier`,
  },
  exa: {
    hue: "#1f40ed",
    developer: "Exa",
    prompts: prompts("exa"),
  },
  hubspot: {
    hue: "#ff7a59",
    developer: "HubSpot",
    prompts: prompts("hubspot"),
  },
  apollo: {
    hue: "#f5b800",
    developer: "Apollo",
    prompts: prompts("apollo"),
  },
  gong: {
    hue: "#8039df",
    developer: "Gong",
    prompts: prompts("gong"),
  },
  "common-room": {
    hue: "#2563eb",
    developer: "Common Room",
    prompts: prompts("commonRoom"),
  },
  intercom: {
    hue: "#0057ff",
    developer: "Intercom",
    prompts: prompts("intercom"),
  },
  pylon: {
    hue: "#6d28d9",
    developer: "Pylon",
    prompts: prompts("pylon"),
  },
  amplitude: {
    hue: "#1e61f0",
    developer: "Amplitude",
    prompts: prompts("amplitude"),
  },
  fullstory: {
    hue: "#7b3fe4",
    developer: "FullStory",
    prompts: prompts("fullstory"),
  },
  sigma: {
    hue: "#2563eb",
    developer: "Sigma",
    prompts: prompts("sigma"),
  },
  stripe: {
    hue: "#635bff",
    developer: "Stripe",
    prompts: prompts("stripe"),
  },
  paypal: {
    hue: "#0070e0",
    developer: "PayPal",
    prompts: prompts("paypal"),
  },
  slack: {
    unavailable: true,
    hue: "#4a154b",
    developer: "Slack",
    prompts: prompts("slack"),
  },
  "google-docs": {
    hue: "#4285f4",
    developer: "Google",
    prompts: prompts("googleDocs"),
  },
  telegram: {
    hue: "#26a5e4",
    developer: "Telegram",
    prompts: prompts("telegram"),
  },
  whatsapp: {
    hue: "#25d366",
    developer: "Meta",
    prompts: prompts("whatsapp"),
  },
  discord: { developer: "Discord" },
  "microsoft-teams": { developer: "Microsoft" },
};

export function integrationBrand(id: string): IntegrationBrand | undefined {
  return BRANDS[id];
}
