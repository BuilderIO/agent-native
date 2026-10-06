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
    const hostname = url.hostname.toLowerCase();
    const ipv6 = hostname.replace(/^\[|\]$/g, "");
    const privateIpv4 =
      /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        hostname,
      ) ||
      hostname === "0.0.0.0" ||
      /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname);
    const privateIpv6 =
      ipv6 === "::" ||
      ipv6 === "::1" ||
      /^(?:fc|fd)/.test(ipv6) ||
      /^fe[89ab]/.test(ipv6) ||
      /^::ffff:(?:10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        ipv6,
      );
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && hostname === "localhost")) ||
      (hostname !== "localhost" && (privateIpv4 || privateIpv6)) ||
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
  targetPath = "/",
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
  const normalizedTargetPath = targetPath.replace(/\/+$/, "") || "/";
  const normalizedCardPath = cardUrl.pathname.replace(/\/+$/, "") || "/";
  if (
    normalizedTargetPath !== "/" &&
    normalizedCardPath !== normalizedTargetPath &&
    !normalizedCardPath.startsWith(`${normalizedTargetPath}/`)
  ) {
    return null;
  }
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

export function buildIdentityConnectUrl(appUrl: string): string {
  const url = appPathUrl(appUrl, "/_agent-native/identity/login");
  url.searchParams.set("prompt", "none");
  url.searchParams.set(
    "return",
    appPathUrl(appUrl, "/_agent-native/open").pathname,
  );
  return url.toString();
}

export async function fetchMarketplaceApps(
  feedUrl = "https://www.agent-native.com/apps.json",
): Promise<MarketplaceApp[]> {
  const response = await fetch(feedUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    throw new Error(`Marketplace feed returned ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 1_000_000) throw new Error("Marketplace feed is too large");
  const body = await response.text();
  if (body.length > 1_000_000) throw new Error("Marketplace feed is too large");
  const payload = JSON.parse(body) as { apps?: unknown };
  if (!Array.isArray(payload.apps))
    throw new Error("Marketplace feed is invalid");
  const candidates = payload.apps.filter((entry): entry is MarketplaceApp => {
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
  const verified = await Promise.allSettled(
    candidates.map(async (app) => {
      const card = await fetchConnectAgentCard(app.url);
      return card.connect ? { ...app, capabilities: ["connect"] } : null;
    }),
  );
  return verified.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
}

export async function fetchConnectAgentCard(
  appUrl: string,
): Promise<ConnectAgentCard> {
  const target = normalizeConnectUrl(appUrl);
  if (!target) throw new Error("Enter a secure app URL.");
  const response = await fetch(
    appPathUrl(target.toString(), "/.well-known/agent-card.json").toString(),
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new Error(`Agent card returned ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 256_000) throw new Error("Agent card is too large");
  const body = await response.text();
  if (body.length > 256_000) throw new Error("Agent card is too large");
  const card = parseConnectAgentCard(
    JSON.parse(body),
    target.origin,
    target.pathname,
  );
  if (!card)
    throw new Error("This app has an invalid or incompatible agent card.");
  return card;
}

function appPathUrl(appUrl: string, suffix: string): URL {
  const target = new URL(appUrl);
  const prefix = target.pathname.replace(/\/+$/, "");
  return new URL(`${prefix}${suffix}`, target.origin);
}
