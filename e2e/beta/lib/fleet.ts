import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export interface BetaSite {
  id: string;
  siteId: string;
  host: string;
  e2e?: boolean;
}

const GOOGLE_ONLY_APPS = new Set(["calendar", "factory", "mail"]);

const CHAT_APPS = ["chat", "slides", "analytics", "content", "dispatch"];
const AUTHENTICATED_ENTRY_PATHS: Record<string, string> = {
  design: "/home",
  content: "/home",
  slides: "/home",
};

function readSites(): BetaSite[] {
  const file = path.join(repoRoot, "scripts", "netlify-beta-sites.json");
  const raw = readFileSync(file, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${file} did not contain a non-empty array of beta sites.`);
  }
  return parsed.map((entry, index) => {
    const site = entry as Partial<BetaSite>;
    if (!site.id || !site.host || !site.siteId) {
      throw new Error(
        `${file}[${index}] is missing id/host/siteId: ${JSON.stringify(entry)}`,
      );
    }
    if (!site.host.startsWith("beta.")) {
      throw new Error(
        `${file}[${index}] host ${site.host} is not a beta host. This suite must never be pointed at production.`,
      );
    }
    return {
      id: site.id,
      siteId: site.siteId,
      host: site.host,
      e2e: site.e2e,
    };
  });
}

export const ALL_SITES: BetaSite[] = readSites();

export function selectedSites(): BetaSite[] {
  const raw = process.env.BETA_E2E_APPS?.trim();
  const disposableChat = disposableChatSite();
  if (disposableChat && raw?.toLowerCase() !== "chat") {
    throw new Error(
      "BETA_E2E_DISPOSABLE_CHAT_ORIGIN is only valid with BETA_E2E_APPS=chat.",
    );
  }
  const selectableSites = ALL_SITES.filter((site) => site.e2e !== false);
  if (!raw || raw === "all") return selectableSites;
  const wanted = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) {
    throw new Error(
      `BETA_E2E_APPS=${JSON.stringify(raw)} names no app. Use "all" or a comma-separated list of app ids.`,
    );
  }
  const known = new Map(selectableSites.map((site) => [site.id, site]));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `BETA_E2E_APPS names unknown app(s): ${unknown.join(", ")}. Known: ${[...known.keys()].join(", ")}`,
    );
  }
  return wanted.map((id) => {
    if (id === "chat" && disposableChat) return disposableChat;
    const site = known.get(id);
    if (!site) throw new Error(`BETA_E2E_APPS contains unknown app: ${id}`);
    return site;
  });
}

export function siteById(id: string): BetaSite {
  if (id === "chat") {
    const disposableChat = disposableChatSite();
    if (disposableChat) return disposableChat;
  }
  const site = ALL_SITES.find((entry) => entry.id === id);
  if (!site) {
    throw new Error(
      `No beta site named ${id} in scripts/netlify-beta-sites.json.`,
    );
  }
  return site;
}

function disposableChatSite(): BetaSite | undefined {
  const raw = process.env.BETA_E2E_DISPOSABLE_CHAT_ORIGIN?.trim();
  if (!raw) return undefined;

  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    throw new Error(
      "BETA_E2E_DISPOSABLE_CHAT_ORIGIN must be the isolated Netlify Chat origin.",
    );
  }
  if (
    origin.protocol !== "https:" ||
    origin.hostname !== "an-deploy-ci-netlify-local.netlify.app" ||
    origin.port ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      "BETA_E2E_DISPOSABLE_CHAT_ORIGIN must be exactly https://an-deploy-ci-netlify-local.netlify.app/.",
    );
  }
  return {
    id: "chat",
    siteId: "an-deploy-ci-netlify-local",
    host: origin.hostname,
    e2e: true,
  };
}

export function originFor(site: BetaSite | string): string {
  const host = typeof site === "string" ? siteById(site).host : site.host;
  return `https://${host}`;
}

export function authenticatedEntryPath(site: BetaSite | string): string {
  const id = typeof site === "string" ? site : site.id;
  return AUTHENTICATED_ENTRY_PATHS[id] ?? "/";
}

export function productionHostFor(site: BetaSite): string {
  return site.host.replace(/^beta\./, "");
}

export function isGoogleOnly(site: BetaSite | string): boolean {
  const id = typeof site === "string" ? site : site.id;
  return GOOGLE_ONLY_APPS.has(id);
}

export function authenticatableSites(): BetaSite[] {
  return selectedSites().filter((site) => !isGoogleOnly(site));
}

export function chatSites(): BetaSite[] {
  const selected = new Set(selectedSites().map((site) => site.id));
  return CHAT_APPS.filter((id) => selected.has(id)).map(siteById);
}
