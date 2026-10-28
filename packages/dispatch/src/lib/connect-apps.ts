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

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function mappedIpv4(hostname: string): string | null {
  const match = /^::ffff:(.*)$/i.exec(hostname);
  if (!match) return null;
  if (match[1].includes(".")) return match[1];
  const words = match[1].split(":");
  if (
    words.length !== 2 ||
    words.some((word) => !/^[\da-f]{1,4}$/i.test(word))
  ) {
    return null;
  }
  const high = Number.parseInt(words[0], 16);
  const low = Number.parseInt(words[1], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function normalizeConnectUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    const ipv6 = hostname.replace(/^\[|\]$/g, "");
    const privateIpv4 = isPrivateIpv4(hostname);
    const mappedAddress = mappedIpv4(ipv6);
    const privateIpv6 =
      ipv6.includes(":") &&
      (ipv6 === "::" ||
        ipv6 === "::1" ||
        /^(?:fc|fd)/.test(ipv6) ||
        /^fe[89ab]/.test(ipv6) ||
        Boolean(mappedAddress && isPrivateIpv4(mappedAddress)));
    if (
      url.protocol !== "https:" ||
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

export function buildAgentCardUrl(appUrl: string): string {
  return appPathUrl(appUrl, "/.well-known/agent-card.json").toString();
}

function appPathUrl(appUrl: string, suffix: string): URL {
  const target = new URL(appUrl);
  const prefix = target.pathname.replace(/\/+$/, "");
  return new URL(`${prefix}${suffix}`, target.origin);
}
