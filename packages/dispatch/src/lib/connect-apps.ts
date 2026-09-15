export interface ConnectAgentCard {
  name: string;
  description: string;
  url: string;
  connect: boolean;
}

export interface MarketplaceApp {
  id: string;
  name: string;
  description: string;
  url: string;
  capabilities: string[];
  source?: "first-party" | "community";
}

export function normalizeConnectUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && url.hostname === "localhost")) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    // coercion-ok: malformed user input is an explicit invalid URL result.
    return null;
  }
}

export function parseConnectAgentCard(
  value: unknown,
  targetOrigin: string,
): ConnectAgentCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Record<string, unknown>;
  if (
    typeof card.name !== "string" ||
    typeof card.description !== "string" ||
    typeof card.url !== "string"
  ) {
    return null;
  }
  let cardUrl: URL;
  try {
    cardUrl = new URL(card.url);
  } catch {
    // coercion-ok: an invalid agent-card URL is an explicit invalid card result.
    return null;
  }
  if (cardUrl.username || cardUrl.password) return null;
  if (cardUrl.origin !== targetOrigin) return null;
  const capabilities =
    card.capabilities && typeof card.capabilities === "object"
      ? (card.capabilities as Record<string, unknown>)
      : {};
  return {
    name: card.name.trim(),
    description: card.description.trim(),
    url: cardUrl.toString(),
    connect: capabilities.connect === true,
  };
}

/**
 * Starts the existing app-side identity handoff. The app remains the session
 * client; no wildcard cookie or shared bearer is introduced.
 */
export function buildIdentityConnectUrl(appUrl: string): string {
  const url = new URL("/_agent-native/identity/login", appUrl);
  url.searchParams.set("prompt", "none");
  url.searchParams.set("return", "/_agent-native/open");
  return url.toString();
}

export async function fetchMarketplaceApps(
  feedUrl = "https://www.agent-native.com/apps.json",
): Promise<MarketplaceApp[]> {
  const response = await fetch(feedUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Marketplace feed returned ${response.status}`);
  const payload = (await response.json()) as { apps?: unknown };
  if (!Array.isArray(payload.apps))
    throw new Error("Marketplace feed is invalid");
  return payload.apps.filter((entry): entry is MarketplaceApp => {
    if (!entry || typeof entry !== "object") return false;
    const app = entry as Record<string, unknown>;
    const url =
      typeof app.url === "string" ? normalizeConnectUrl(app.url) : null;
    return (
      typeof app.id === "string" &&
      typeof app.name === "string" &&
      typeof app.description === "string" &&
      typeof app.url === "string" &&
      Boolean(url) &&
      Array.isArray(app.capabilities) &&
      app.capabilities.every((capability) => typeof capability === "string")
    );
  });
}

export async function fetchConnectAgentCard(
  appUrl: string,
): Promise<ConnectAgentCard> {
  const target = normalizeConnectUrl(appUrl);
  if (!target) throw new Error("Enter a secure app URL.");
  const response = await fetch(
    new URL("/.well-known/agent-card.json", target).toString(),
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`Agent card returned ${response.status}`);
  const card = parseConnectAgentCard(await response.json(), target.origin);
  if (!card)
    throw new Error("This app has an invalid or incompatible agent card.");
  return card;
}
