import { readDeployCredentialEnv } from "@agent-native/core/server";

import {
  communityApps as seedCommunityApps,
  type CommunityApp,
  type CommunityAppStatus,
} from "../../app/components/community-apps";

export const COMMUNITY_APP_BUILDER_MODEL = "community-apps";
const BUILDER_CONTENT_API = "https://cdn.builder.io";
const BUILDER_READ_TIMEOUT_MS = 8_000;
const COMMUNITY_APP_CATALOG_TTL_MS = 30_000;

let catalogCache:
  | {
      publicKey: string;
      expiresAt: number;
      catalog: CommunityAppCatalog;
    }
  | undefined;

export type CommunityAppCatalog = {
  apps: CommunityApp[];
  source: "builder" | "seed";
};

export class CommunityAppCatalogError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "CommunityAppCatalogError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim();
  if (!URL.canParse(normalized)) return undefined;
  const url = new URL(normalized);
  return (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password
    ? url.href
    : undefined;
}

function stringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeStatus(value: unknown): CommunityAppStatus | undefined {
  return value === "new" || value === "comingSoon" ? value : undefined;
}

function normalizeScreenshots(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) => {
    const url = isRecord(item) ? item.url : item;
    const safe = safeHttpUrl(url);
    return safe ? [safe] : [];
  });
}

export function normalizeCommunityAppEntry(
  value: unknown,
): CommunityApp | null {
  if (!isRecord(value)) return null;
  const data = isRecord(value.data) ? value.data : value;
  const name = stringValue(data, "name") ?? stringValue(value, "name");
  const rawSlug = stringValue(data, "slug") ?? stringValue(value, "id");
  const description = stringValue(data, "description");
  const slug = rawSlug ? slugify(rawSlug) : "";
  if (!name || !description || !slug) return null;

  const rawScreenshots = Array.isArray(data.screenshots)
    ? data.screenshots
    : data.screenshots
      ? [data.screenshots]
      : [];
  const screenshots = normalizeScreenshots(data.screenshots);
  if (rawScreenshots.length !== screenshots.length) return null;

  const githubStars = data.githubStars;
  return {
    slug,
    name,
    description,
    screenshots,
    ...(safeHttpUrl(data.demoUrl)
      ? { demoUrl: safeHttpUrl(data.demoUrl) }
      : {}),
    ...(safeHttpUrl(data.repositoryUrl)
      ? { repositoryUrl: safeHttpUrl(data.repositoryUrl) }
      : {}),
    ...(safeHttpUrl(data.sourceUrl)
      ? { sourceUrl: safeHttpUrl(data.sourceUrl) }
      : {}),
    ...(stringValue(data, "sourceLabel")
      ? { sourceLabel: stringValue(data, "sourceLabel") }
      : {}),
    ...(typeof githubStars === "number" &&
    Number.isFinite(githubStars) &&
    githubStars >= 0
      ? { githubStars }
      : {}),
    ...(normalizeStatus(data.status)
      ? { status: normalizeStatus(data.status) }
      : {}),
  };
}

function entriesFromPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isRecord(value) && Array.isArray(value.results) ? value.results : [];
}

function normalizeEntries(value: unknown): CommunityApp[] {
  const seen = new Set<string>();
  const apps: CommunityApp[] = [];
  for (const entry of entriesFromPayload(value)) {
    const app = normalizeCommunityAppEntry(entry);
    if (!app || seen.has(app.slug)) continue;
    seen.add(app.slug);
    apps.push(app);
  }
  return apps;
}

function mergeSeedAndBuilderApps(builderApps: CommunityApp[]): CommunityApp[] {
  const apps = new Map(seedCommunityApps.map((app) => [app.slug, app]));
  for (const app of builderApps) apps.set(app.slug, app);
  return [...apps.values()];
}

export async function loadCommunityAppCatalog(
  fetchImpl: typeof fetch = fetch,
): Promise<CommunityAppCatalog> {
  const publicKey = readDeployCredentialEnv("BUILDER_PUBLIC_KEY");
  if (!publicKey) {
    return { apps: seedCommunityApps, source: "seed" };
  }

  if (
    fetchImpl === fetch &&
    catalogCache?.publicKey === publicKey &&
    catalogCache.expiresAt > Date.now()
  ) {
    return catalogCache.catalog;
  }

  const url = new URL(
    `/api/v3/content/${encodeURIComponent(COMMUNITY_APP_BUILDER_MODEL)}`,
    BUILDER_CONTENT_API,
  );
  url.searchParams.set("apiKey", publicKey);
  url.searchParams.set("limit", "100");
  url.searchParams.set("noTargeting", "true");
  url.searchParams.set("fields", "id,name,published,data");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BUILDER_READ_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CommunityAppCatalogError(
        `Builder community catalog returned HTTP ${response.status}.`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CommunityAppCatalogError(
        "Builder community catalog returned invalid JSON.",
      );
    }
    const catalog = {
      apps: mergeSeedAndBuilderApps(normalizeEntries(body)),
      source: "builder" as const,
    };
    if (fetchImpl === fetch) {
      catalogCache = {
        publicKey,
        expiresAt: Date.now() + COMMUNITY_APP_CATALOG_TTL_MS,
        catalog,
      };
    }
    return catalog;
  } catch (error) {
    if (fetchImpl === fetch) {
      const lastKnownGood =
        catalogCache?.publicKey === publicKey
          ? catalogCache.catalog
          : undefined;
      return lastKnownGood ?? { apps: seedCommunityApps, source: "seed" };
    }
    if (error instanceof CommunityAppCatalogError) throw error;
    throw new CommunityAppCatalogError(
      controller.signal.aborted
        ? "Builder community catalog timed out."
        : "Builder community catalog could not be reached.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
