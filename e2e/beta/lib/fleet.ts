import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The beta fleet under test.
 *
 * The site list is read from the same `scripts/netlify-beta-sites.json` the
 * deploy workflow publishes from, so a new beta site is covered by this suite
 * the moment it is deployable — there is no second list to forget.
 */

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
}

/**
 * Apps whose sign-in is Google-only (`googleOnly: true` in their auth plugin),
 * so a seeded session grants no provider tokens and the product surface behind
 * it is not meaningfully exercisable from CI. They still get the full
 * unauthenticated sweep — which is where their reported breakage lives.
 */
const GOOGLE_ONLY_APPS = new Set(["mail", "calendar"]);

/**
 * Apps that carry an agent chat surface worth spending model tokens on. Kept
 * explicit rather than derived: adding an app here costs real money per run,
 * so it should be a decision someone makes, not a side effect of deploying.
 */
const CHAT_APPS = ["chat", "slides", "analytics", "content", "dispatch"];

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
    return { id: site.id, siteId: site.siteId, host: site.host };
  });
}

export const ALL_SITES: BetaSite[] = readSites();

/**
 * Restrict the run to a subset, e.g. `BETA_E2E_APPS=slides,analytics`.
 *
 * An unknown id is an error, not an empty selection: a typo in a workflow
 * input must not present as "everything passed".
 */
export function selectedSites(): BetaSite[] {
  const raw = process.env.BETA_E2E_APPS?.trim();
  if (!raw || raw === "all") return ALL_SITES;
  const wanted = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const known = new Map(ALL_SITES.map((site) => [site.id, site]));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `BETA_E2E_APPS names unknown app(s): ${unknown.join(", ")}. Known: ${[...known.keys()].join(", ")}`,
    );
  }
  return wanted.map((id) => known.get(id)!);
}

export function siteById(id: string): BetaSite {
  const site = ALL_SITES.find((entry) => entry.id === id);
  if (!site) {
    throw new Error(
      `No beta site named ${id} in scripts/netlify-beta-sites.json.`,
    );
  }
  return site;
}

export function originFor(site: BetaSite | string): string {
  const host = typeof site === "string" ? siteById(site).host : site.host;
  return `https://${host}`;
}

/** The production twin of a beta host, used for isolation checks. */
export function productionHostFor(site: BetaSite): string {
  return site.host.replace(/^beta\./, "");
}

export function isGoogleOnly(site: BetaSite | string): boolean {
  const id = typeof site === "string" ? site : site.id;
  return GOOGLE_ONLY_APPS.has(id);
}

/** Sites eligible for an authenticated journey, honouring `BETA_E2E_APPS`. */
export function authenticatableSites(): BetaSite[] {
  return selectedSites().filter((site) => !isGoogleOnly(site));
}

/** Sites whose agent chat is worth spending luna tokens on this run. */
export function chatSites(): BetaSite[] {
  const selected = new Set(selectedSites().map((site) => site.id));
  return CHAT_APPS.filter((id) => selected.has(id)).map(siteById);
}
