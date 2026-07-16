import type { ContextMediaInput } from "../types.js";
import { normalizeContextItem } from "./normalize.js";
import {
  fetchRemoteArtifact,
  sanitizeProvenanceUrl,
  sanitizeRemoteArtifact,
  storePrivateArtifact,
} from "./private-artifacts.js";
import {
  asRecord,
  cursorOffset,
  positiveLimit,
  stringArray,
  stringValue,
} from "./provider-response.js";
import {
  boundWebsiteExtraction,
  LayeredRenderedPageProvider,
} from "./rendered-page.js";
import type {
  ContextConnectorExecutionContext,
  ContextConnectorFetchRequest,
  ContextConnectorFetchResult,
  ContextConnectorInventoryPage,
  ContextConnectorInventoryRequest,
  ContextImportConnector,
} from "./types.js";

export interface WebsiteReference {
  url: string;
  title: string;
}

export class WebsiteContextConnector implements ContextImportConnector {
  readonly kind = "website" as const;
  readonly label = "Websites";
  readonly supportsIncremental = true;
  readonly #defaultRenderer = new LayeredRenderedPageProvider();

  async inventory(
    request: ContextConnectorInventoryRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorInventoryPage> {
    const discovered = await discoverWebsiteInventory(
      request.config,
      context.signal,
    );
    const references = discovered.references;
    const offset = cursorOffset(request.cursor);
    const limit = positiveLimit(request.limit, 100, 1_000);
    const slice = references.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return {
      items: slice.map((reference) => ({
        externalId: reference.url,
        kind: "web-page",
        title: reference.title,
        canonicalUrl: reference.url,
        mimeType: "text/html",
      })),
      nextCursor: nextOffset < references.length ? String(nextOffset) : null,
      complete: nextOffset >= references.length,
      coverage: {
        inspected: discovered.inspected,
        returned: slice.length,
        truncated: discovered.truncated || nextOffset < references.length,
      },
    };
  }

  async fetch(
    request: ContextConnectorFetchRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorFetchResult> {
    const renderer = context.renderedPages ?? this.#defaultRenderer;
    const rawRendered = await renderer.render({
      url: request.item.canonicalUrl ?? request.item.externalId,
      timeoutMs: finiteNumber(request.config.timeoutMs),
      waitUntil: waitUntil(request.config.waitUntil),
      preferHosted: request.config.preferHosted !== false,
    });
    const rawExtraction = boundWebsiteExtraction(rawRendered.extraction);
    const rendered = {
      ...rawRendered,
      url: sanitizeProvenanceUrl(rawRendered.url),
      finalUrl: sanitizeProvenanceUrl(rawRendered.finalUrl),
      title: rawRendered.title.slice(0, 500),
      text: rawRendered.text.slice(0, 2_000_000),
      warnings: rawRendered.warnings
        .slice(0, 100)
        .map((value) => sanitizeUrlLikeStrings(value.slice(0, 2_000))),
      diagnostics: rawRendered.diagnostics
        .slice(0, 100)
        .map((value) => sanitizeUrlLikeStrings(value.slice(0, 2_000))),
      extraction: sanitizeUrlValues(rawExtraction),
      metadata: sanitizeUrlValues(boundedJsonValue(rawRendered.metadata)),
      screenshots: rawRendered.screenshots
        .filter((value) => value.data.byteLength <= 10 * 1024 * 1024)
        .slice(0, 2),
    };
    const capturedAt = (context.now?.() ?? new Date()).toISOString();
    const { screenshots, ...serializable } = rendered;
    const serializedSnapshot = serializeRenderedSnapshot(serializable);
    const snapshot = await storePrivateArtifact({
      data: serializedSnapshot.data,
      filename: `${safeFileName(new URL(rendered.finalUrl).hostname)}-${safeFileName(capturedAt)}.json`,
      mimeType: "application/json",
      context,
      metadata: {
        kind: "rendered-web-page",
        renderMethod: rendered.method,
      },
    });
    const screenshotArtifacts = await Promise.all(
      screenshots.map(async (screenshot) => ({
        screenshot,
        artifact: await storePrivateArtifact({
          data: screenshot.data,
          filename: `${safeFileName(new URL(rendered.finalUrl).hostname)}-${safeFileName(capturedAt)}-${screenshot.viewport}.png`,
          mimeType: "image/png",
          context,
          metadata: {
            kind: "rendered-web-page-screenshot",
            renderMethod: rendered.method,
            viewport: screenshot.viewport,
          },
        }),
      })),
    );
    const rehostedAssets = await rehostUsefulWebsiteAssets(
      rawExtraction.assets,
      rawRendered.finalUrl,
      request.config,
      context,
    );
    return {
      items: [
        normalizeContextItem({
          externalId: request.item.externalId,
          kind: request.item.kind,
          title: rendered.title || request.item.title,
          canonicalUrl: rendered.finalUrl,
          mimeType: "text/html",
          content: rendered.text,
          sourceModifiedAt:
            typeof rendered.metadata.lastModified === "string"
              ? rendered.metadata.lastModified
              : undefined,
          sourceVersion:
            typeof rendered.metadata.etag === "string"
              ? rendered.metadata.etag
              : undefined,
          rawSnapshotBlobRef: snapshot.reference,
          parseStatus: "parsed",
          provenance: {
            provider: "website",
            requestedUrl: rendered.url,
            finalUrl: rendered.finalUrl,
            renderMethod: rendered.method,
          },
          metadata: {
            provider: "website",
            requestedUrl: rendered.url,
            renderMethod: rendered.method,
            rendered: rendered.rendered,
            warnings: [...rendered.warnings, ...rehostedAssets.warnings],
            confidence: rendered.confidence,
            classification: rendered.classification,
            diagnostics: [
              ...rendered.diagnostics,
              ...(serializedSnapshot.truncated
                ? [
                    `Serialized rendered snapshot was compacted to ${serializedSnapshot.data.byteLength} bytes.`,
                  ]
                : []),
            ],
            capturedAt,
            extraction: rendered.extraction,
            ...rendered.metadata,
          },
          media: [
            {
              kind: "document",
              mimeType: "application/json",
              accessMode: "private",
              storageKey: snapshot.reference,
              provenanceUrl: rendered.finalUrl,
              contentHash: snapshot.contentHash,
              captionStatus: "not-needed",
              metadata: { artifact: "rendered-page-snapshot" },
            },
            ...screenshotArtifacts.map(({ screenshot, artifact }) => ({
              kind: "image" as const,
              mimeType: "image/png",
              accessMode: "private" as const,
              storageKey: artifact.reference,
              provenanceUrl: rendered.finalUrl,
              altText: `${screenshot.viewport} screenshot of ${rendered.title}`,
              width: screenshot.width,
              height: screenshot.height,
              contentHash: artifact.contentHash,
              palette: artifact.palette,
              captionStatus: "pending" as const,
              metadata: {
                artifact: "rendered-page-screenshot",
                viewport: screenshot.viewport,
              },
            })),
            ...rehostedAssets.media,
          ],
          thumbnailBlobRef: screenshotArtifacts[0]?.artifact.reference,
        }),
      ],
      warnings: [...rendered.warnings, ...rehostedAssets.warnings],
    };
  }
}

async function rehostUsefulWebsiteAssets(
  assets: Array<{
    url: string;
    kind: "image" | "video" | "audio" | "font" | "stylesheet" | "script";
    role?: "logo" | "open-graph";
  }>,
  finalUrl: string,
  config: Record<string, unknown>,
  context: ContextConnectorExecutionContext,
): Promise<{ media: ContextMediaInput[]; warnings: string[] }> {
  if (config.rehostAssets === false) return { media: [], warnings: [] };
  const origin = new URL(finalUrl).origin;
  const limit = positiveLimit(config.assetLimit, 20, 50);
  const ranked = [
    ...new Map(
      assets
        .filter((asset) => {
          if (!(["image", "video", "audio"] as string[]).includes(asset.kind)) {
            return false;
          }
          try {
            return new URL(asset.url, finalUrl).origin === origin;
          } catch {
            return false;
          }
        })
        .map((asset) => [new URL(asset.url, finalUrl).href, asset] as const),
    ).entries(),
  ]
    .map(([url, asset]) => ({ ...asset, url }))
    .sort((left, right) => websiteAssetRank(right) - websiteAssetRank(left))
    .slice(0, limit);
  const media: ContextMediaInput[] = [];
  const warnings: string[] = [];
  for (const asset of ranked) {
    try {
      const remote = await fetchRemoteArtifact(asset.url, context);
      const mimeType = remote.mimeType?.split(";")[0]?.trim().toLowerCase();
      if (!mimeType || !mimeMatchesKind(mimeType, asset.kind)) {
        warnings.push(
          `Skipped website asset with unexpected MIME ${mimeType ?? "unknown"}: ${asset.url}`,
        );
        continue;
      }
      const data = sanitizeRemoteArtifact({
        data: remote.data,
        mimeType,
        filename: websiteAssetFilename(asset.url, mimeType),
      });
      const stored = await storePrivateArtifact({
        data,
        filename: websiteAssetFilename(asset.url, mimeType),
        mimeType,
        context,
        metadata: {
          kind: asset.kind,
          role: asset.role,
          source: "website-context-import",
          canonicalLogoCandidate:
            asset.role === "logo" || isLogoLikeAsset(asset.url),
        },
      });
      media.push({
        kind: websiteMediaKind(asset.kind),
        mimeType,
        accessMode: "private",
        storageKey: stored.reference,
        provenanceUrl: sanitizeProvenanceUrl(remote.finalUrl),
        contentHash: stored.contentHash,
        ...(stored.palette.length ? { palette: stored.palette } : {}),
        captionStatus: asset.kind === "image" ? "pending" : "not-needed",
        metadata: {
          provider: "website",
          assetRole: asset.role,
          canonicalLogoCandidate:
            asset.role === "logo" || isLogoLikeAsset(asset.url),
          assetRank: websiteAssetRank(asset),
        },
      });
    } catch (error) {
      warnings.push(
        `Website asset could not be privately rehosted: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { media, warnings };
}

function sanitizeUrlLikeStrings(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) =>
    sanitizeProvenanceUrl(candidate),
  );
}

function sanitizeUrlValues<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeUrlLikeStrings(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUrlValues(entry)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sanitizeUrlValues(entry),
    ]),
  ) as T;
}

function websiteMediaKind(kind: string): "image" | "video" | "audio" | "other" {
  return kind === "image" || kind === "video" || kind === "audio"
    ? kind
    : "other";
}

function websiteAssetRank(asset: {
  url: string;
  kind: string;
  role?: "logo" | "open-graph";
}): number {
  return (
    (asset.role === "logo"
      ? 120
      : isLogoLikeAsset(asset.url)
        ? 100
        : asset.role === "open-graph"
          ? 80
          : 0) + (asset.kind === "image" ? 20 : asset.kind === "video" ? 10 : 5)
  );
}

function isLogoLikeAsset(url: string): boolean {
  return /(?:^|[\/_\-.])(logo|brand|wordmark|logomark|favicon|og[-_]?image|icon)(?:[\/_\-.]|$)/i.test(
    new URL(url).pathname,
  );
}

function mimeMatchesKind(mimeType: string, kind: string): boolean {
  return mimeType.startsWith(`${kind}/`);
}

function websiteAssetFilename(url: string, mimeType: string): string {
  const pathname = new URL(url).pathname;
  const basename = pathname.split("/").filter(Boolean).at(-1);
  const extension = mimeType.split("/")[1]?.replace("svg+xml", "svg") ?? "bin";
  return safeFileName(basename ?? `website-asset.${extension}`);
}

const MAX_RENDERED_SNAPSHOT_BYTES = 2 * 1024 * 1024;

function serializeRenderedSnapshot(value: Record<string, unknown>): {
  data: Uint8Array;
  truncated: boolean;
} {
  const encoder = new TextEncoder();
  const first = encoder.encode(JSON.stringify(value));
  if (first.byteLength <= MAX_RENDERED_SNAPSHOT_BYTES) {
    return { data: first, truncated: false };
  }
  const extraction = asRecord(value.extraction);
  const designTokens = asRecord(extraction?.designTokens);
  const compact = {
    ...value,
    text: stringValue(value.text)?.slice(0, 200_000) ?? "",
    diagnostics: [
      ...(Array.isArray(value.diagnostics)
        ? value.diagnostics.slice(0, 25)
        : []),
      "Snapshot arrays and text were compacted to the private artifact byte limit.",
    ],
    extraction: {
      ...(extraction ?? {}),
      text: stringValue(extraction?.text)?.slice(0, 200_000) ?? "",
      assets: Array.isArray(extraction?.assets)
        ? extraction.assets.slice(0, 100)
        : [],
      internalLinks: Array.isArray(extraction?.internalLinks)
        ? extraction.internalLinks.slice(0, 100)
        : [],
      designTokens: {
        ...(designTokens ?? {}),
        colors: Array.isArray(designTokens?.colors)
          ? designTokens.colors.slice(0, 100)
          : [],
        typography: Array.isArray(designTokens?.typography)
          ? designTokens.typography.slice(0, 50)
          : [],
        spacing: Array.isArray(designTokens?.spacing)
          ? designTokens.spacing.slice(0, 50)
          : [],
        radii: Array.isArray(designTokens?.radii)
          ? designTokens.radii.slice(0, 32)
          : [],
      },
    },
    snapshotTruncated: true,
  };
  const data = encoder.encode(JSON.stringify(compact));
  if (data.byteLength <= MAX_RENDERED_SNAPSHOT_BYTES) {
    return { data, truncated: true };
  }
  return {
    data: encoder.encode(
      JSON.stringify({
        url: value.url,
        finalUrl: value.finalUrl,
        title: value.title,
        method: value.method,
        rendered: value.rendered,
        classification: value.classification,
        confidence: value.confidence,
        diagnostics: [
          "Snapshot content exceeded the private artifact byte limit and was reduced to metadata.",
        ],
        snapshotTruncated: true,
      }),
    ),
    truncated: true,
  };
}

function boundedJsonValue(value: unknown, depth = 0): Record<string, unknown> {
  const record = asRecord(value);
  if (!record || depth >= 4) return {};
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 100)
      .map(([key, entry]) => [
        key.slice(0, 500),
        boundedEntry(entry, depth + 1),
      ]),
  );
}

function boundedEntry(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.slice(0, 4_096);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => boundedEntry(entry, depth + 1));
  }
  return boundedJsonValue(value, depth);
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "website";
}

export async function discoverWebsiteInventory(
  config: Record<string, unknown>,
  signal?: AbortSignal,
  fetcher: typeof ssrfSafeFetch = ssrfSafeFetch,
): Promise<{
  references: WebsiteReference[];
  inspected: number;
  truncated: boolean;
}> {
  const references = new Map<string, WebsiteReference>();
  for (const value of stringArray(config.urls)) {
    const url = normalizeWebsiteUrl(value);
    references.set(url, { url, title: new URL(url).hostname });
  }
  if (Array.isArray(config.pages)) {
    for (const value of config.pages) {
      const page = asRecord(value);
      const inputUrl = stringValue(page?.url);
      if (!inputUrl) continue;
      const url = normalizeWebsiteUrl(inputUrl);
      references.set(url, {
        url,
        title: stringValue(page?.title) ?? new URL(url).hostname,
      });
    }
  }
  const roots = [
    ...stringArray(config.domains),
    ...stringArray(config.baseUrls),
  ].map(normalizeWebsiteRoot);
  const explicitSitemaps = stringArray(config.sitemapUrls).map(
    normalizeWebsiteUrl,
  );
  const allowedOrigins = new Set([
    ...roots.map((root) => new URL(root).origin),
    ...explicitSitemaps.map((sitemap) => new URL(sitemap).origin),
  ]);
  if (
    references.size === 0 &&
    roots.length === 0 &&
    explicitSitemaps.length === 0
  ) {
    throw new Error(
      "Website connector config requires explicit urls, domains/baseUrls, or sitemapUrls.",
    );
  }
  const maxPages = positiveLimit(config.maxPages, 100, 1_000);
  const maxBytes = positiveLimit(
    config.maxInventoryBytes,
    5 * 1024 * 1024,
    20 * 1024 * 1024,
  );
  const deadline =
    Date.now() + positiveLimit(config.maxInventoryMs, 15_000, 60_000);
  let consumedBytes = 0;
  let inspected = references.size;
  let truncated = false;
  const robotsByOrigin = new Map<string, RobotsPolicy>();
  const sitemapQueue = [...explicitSitemaps];
  for (const origin of allowedOrigins) {
    if (consumedBytes >= maxBytes || Date.now() >= deadline) {
      truncated = true;
      break;
    }
    const robots = await fetchRobots(
      origin,
      signal,
      fetcher,
      maxBytes - consumedBytes,
    ).catch(() => ({
      policy: { disallow: [], sitemaps: [] },
      byteLength: 0,
    }));
    consumedBytes += robots.byteLength;
    robotsByOrigin.set(origin, robots.policy);
    sitemapQueue.push(...robots.policy.sitemaps, `${origin}/sitemap.xml`);
  }
  for (const root of roots) {
    references.set(root, { url: root, title: new URL(root).hostname });
  }
  const seenSitemaps = new Set<string>();
  while (
    sitemapQueue.length > 0 &&
    references.size < maxPages &&
    Date.now() < deadline
  ) {
    if (consumedBytes >= maxBytes) {
      truncated = true;
      break;
    }
    const sitemap = sitemapQueue.shift()!;
    if (seenSitemaps.has(sitemap)) continue;
    seenSitemaps.add(sitemap);
    if (!allowedOrigins.has(new URL(sitemap).origin)) continue;
    const response = await fetcher(
      sitemap,
      { signal },
      { maxRedirects: 5 },
    ).catch(() => null);
    if (!response?.ok) continue;
    const bytes = await readBoundedResponseBytes(
      response,
      Math.max(1, maxBytes - consumedBytes),
    );
    consumedBytes += bytes.byteLength;
    const xml = new TextDecoder().decode(bytes);
    for (const raw of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
      const url = normalizeDiscoveredUrl(raw[1], response.url || sitemap);
      if (!url) continue;
      inspected++;
      if (!allowedOrigins.has(new URL(url).origin)) continue;
      if (/\.xml(?:$|\?)/i.test(new URL(url).pathname)) {
        sitemapQueue.push(url);
        continue;
      }
      const policy = robotsByOrigin.get(new URL(url).origin);
      if (policy && isRobotsDisallowed(url, policy)) continue;
      references.set(url, { url, title: titleFromWebsiteUrl(url) });
      if (references.size >= maxPages) break;
    }
  }
  for (const root of roots) {
    if (
      references.size >= maxPages ||
      Date.now() >= deadline ||
      consumedBytes >= maxBytes
    ) {
      truncated = true;
      break;
    }
    const response = await fetcher(root, { signal }, { maxRedirects: 5 }).catch(
      () => null,
    );
    if (!response?.ok) continue;
    const bytes = await readBoundedResponseBytes(
      response,
      Math.max(1, maxBytes - consumedBytes),
    );
    consumedBytes += bytes.byteLength;
    const extraction = extractStaticWebsiteContext(
      new TextDecoder().decode(bytes),
      response.url || root,
    );
    const policy = robotsByOrigin.get(new URL(root).origin);
    for (const url of extraction.internalLinks) {
      inspected++;
      if (
        sameOrigin(root, url) &&
        !(policy && isRobotsDisallowed(url, policy))
      ) {
        references.set(url, { url, title: titleFromWebsiteUrl(url) });
      }
      if (references.size >= maxPages) break;
    }
  }
  if (
    Date.now() >= deadline ||
    references.size >= maxPages ||
    consumedBytes >= maxBytes
  )
    truncated = true;
  return {
    references: [...references.values()]
      .sort(
        (a, b) =>
          websitePriority(b.url) - websitePriority(a.url) ||
          a.url.localeCompare(b.url),
      )
      .slice(0, maxPages),
    inspected,
    truncated,
  };
}

interface RobotsPolicy {
  disallow: string[];
  sitemaps: string[];
}

async function fetchRobots(
  origin: string,
  signal: AbortSignal | undefined,
  fetcher: typeof ssrfSafeFetch,
  maxBytes: number,
): Promise<{ policy: RobotsPolicy; byteLength: number }> {
  const response = await fetcher(
    `${origin}/robots.txt`,
    { signal },
    { maxRedirects: 5 },
  );
  if (!response.ok) {
    return { policy: { disallow: [], sitemaps: [] }, byteLength: 0 };
  }
  const bytes = await readBoundedResponseBytes(response, Math.max(1, maxBytes));
  const text = new TextDecoder().decode(bytes);
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let groupAgents: string[] = [];
  let groupDisallow: string[] = [];
  let groupHasDirectives = false;
  const commitGroup = () => {
    if (groupAgents.includes("*")) disallow.push(...groupDisallow);
    groupAgents = [];
    groupDisallow = [];
    groupHasDirectives = false;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const [name, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const field = name?.toLowerCase();
    if (field === "user-agent") {
      if (groupHasDirectives) commitGroup();
      if (value) groupAgents.push(value.toLowerCase());
    } else if (field === "disallow") {
      groupHasDirectives = true;
      if (value) groupDisallow.push(value);
    } else if (field === "allow") {
      groupHasDirectives = true;
    } else if (field === "sitemap" && value) {
      const url = normalizeDiscoveredUrl(value, origin);
      if (url) sitemaps.push(url);
    }
  }
  commitGroup();
  return { policy: { disallow, sitemaps }, byteLength: bytes.byteLength };
}

function isRobotsDisallowed(value: string, policy: RobotsPolicy): boolean {
  const path = `${new URL(value).pathname}${new URL(value).search}`;
  return policy.disallow.some((prefix) =>
    prefix !== "/" ? path.startsWith(prefix) : true,
  );
}

function normalizeWebsiteRoot(value: string): string {
  return normalizeWebsiteUrl(
    /^https?:\/\//i.test(value) ? value : `https://${value}`,
  );
}

function normalizeDiscoveredUrl(value: string, base: string): string | null {
  try {
    return normalizeWebsiteUrl(new URL(value.trim(), base).href);
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  return new URL(a).origin === new URL(b).origin;
}

function titleFromWebsiteUrl(value: string): string {
  const url = new URL(value);
  const part = url.pathname.split("/").filter(Boolean).at(-1);
  return part ? decodeURIComponent(part).replace(/[-_]+/g, " ") : url.hostname;
}

function websitePriority(value: string): number {
  const path = new URL(value).pathname.toLowerCase();
  if (path === "/") return 100;
  if (
    /\/(brand|about|product|features|customers|case-stud|pricing)(\/|$)/.test(
      path,
    )
  )
    return 80;
  if (/\/(docs?|blog|news|legal|privacy|terms)(\/|$)/.test(path)) return 30;
  return 50;
}

function normalizeWebsiteUrl(value: string): string {
  const url = new URL(value);
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error("Website URLs must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Website URLs cannot contain credentials.");
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function waitUntil(
  value: unknown,
): "load" | "domcontentloaded" | "networkidle" | undefined {
  return value === "load" ||
    value === "domcontentloaded" ||
    value === "networkidle"
    ? value
    : undefined;
}
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  extractStaticWebsiteContext,
  readBoundedResponseBytes,
} from "@agent-native/core/ingestion";
