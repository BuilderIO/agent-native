import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

import {
  buildAgentCardUrl,
  normalizeConnectUrl,
  parseConnectAgentCard,
  type ConnectAgentCard,
  type MarketplaceApp,
} from "../../lib/connect-apps.js";

const CONNECT_FETCH_TIMEOUT_MS = 5_000;
const MARKETPLACE_MAX_BYTES = 1_000_000;
const AGENT_CARD_MAX_BYTES = 256_000;
const MAX_MARKETPLACE_CANDIDATES = 50;

async function readLimitedText(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`${label} is too large`);
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} is too large`);
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchJsonText(
  url: string,
  maxBytes: number,
  label: string,
  assertUrlAllowed?: (url: string) => void,
) {
  const response = await ssrfSafeFetch(
    url,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(CONNECT_FETCH_TIMEOUT_MS),
    },
    {
      maxRedirects: 3,
      requireDispatcher: true,
      httpsOnly: true,
      ...(assertUrlAllowed ? { assertUrlAllowed } : {}),
    },
  );
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  return readLimitedText(response, maxBytes, label);
}

export async function fetchConnectAgentCard(
  appUrl: string,
): Promise<ConnectAgentCard> {
  const target = normalizeConnectUrl(appUrl);
  if (!target || target.protocol !== "https:") {
    throw new Error("Enter a secure app URL.");
  }

  const cardUrl = new URL(buildAgentCardUrl(target.toString()));
  const body = await fetchJsonText(
    cardUrl.toString(),
    AGENT_CARD_MAX_BYTES,
    "Agent card",
    (url) => {
      const redirect = new URL(url);
      if (
        redirect.origin !== cardUrl.origin ||
        redirect.pathname !== cardUrl.pathname
      ) {
        throw new Error("Agent card redirects must stay on the requested URL.");
      }
    },
  );
  const card = parseConnectAgentCard(
    JSON.parse(body),
    target.origin,
    target.pathname,
  );
  if (!card) {
    throw new Error("This app has an invalid or incompatible agent card.");
  }
  return card;
}

export async function fetchMarketplaceApps(
  feedUrl = "https://www.agent-native.com/apps.json",
): Promise<MarketplaceApp[]> {
  const feed = normalizeConnectUrl(feedUrl);
  if (!feed || feed.protocol !== "https:") {
    throw new Error("Marketplace feed URL must use HTTPS.");
  }

  const body = await fetchJsonText(
    feed.toString(),
    MARKETPLACE_MAX_BYTES,
    "Marketplace feed",
  );
  const payload = JSON.parse(body) as { apps?: unknown };
  if (!Array.isArray(payload.apps)) {
    throw new Error("Marketplace feed is invalid");
  }

  const candidates = payload.apps
    .filter((entry): entry is MarketplaceApp => {
      if (!entry || typeof entry !== "object") return false;
      const app = entry as Record<string, unknown>;
      const url =
        typeof app.url === "string" ? normalizeConnectUrl(app.url) : null;
      return (
        typeof app.id === "string" &&
        typeof app.name === "string" &&
        typeof app.description === "string" &&
        Boolean(url && url.protocol === "https:") &&
        Array.isArray(app.capabilities) &&
        app.capabilities.every((capability) => typeof capability === "string")
      );
    })
    .slice(0, MAX_MARKETPLACE_CANDIDATES);

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
