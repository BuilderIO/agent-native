/**
 * Serve a Builder container preview from this app's own origin, so the canvas
 * frames it same-origin and the COEP/CORP negotiation disappears.
 *
 * The upstream origin comes from the design's stored linkage, never from the
 * caller, so this cannot be driven as an open proxy.
 */

import { eq } from "drizzle-orm";
import {
  defineEventHandler,
  getHeader,
  getRequestURL,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { parseBuilderPreviewUrl } from "../../shared/builder-preview-url.js";
import { readFusionApp } from "../../shared/full-app.js";
import { getDb, schema } from "../db/index.js";

export const BUILDER_PREVIEW_PROXY_PREFIX = "/builder-preview";

/** Framing and transport headers that must not be copied from upstream. */
const DROPPED_UPSTREAM_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
]);

export function builderPreviewProxyPath(designId: string, path = "/"): string {
  const suffix = path.startsWith("/") ? path.slice(1) : path;
  return `${BUILDER_PREVIEW_PROXY_PREFIX}/${encodeURIComponent(designId)}/${suffix}`;
}

/**
 * The design a proxied document belongs to, read from the referring URL.
 * Subresources the container requests with a root-absolute path land outside
 * the proxy prefix, and this is the only thing tying them back to a design.
 */
export function designIdFromProxyReferer(
  referer: string | undefined,
): string | null {
  if (!referer) return null;
  let path: string;
  try {
    path = new URL(referer).pathname;
    // coercion-ok: an unparsable referer names no design.
  } catch {
    return null;
  }
  if (!path.startsWith(`${BUILDER_PREVIEW_PROXY_PREFIX}/`)) return null;
  const segment = path
    .slice(BUILDER_PREVIEW_PROXY_PREFIX.length + 1)
    .split("/")[0];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
    // coercion-ok: an undecodable segment names no design.
  } catch {
    return null;
  }
}

/**
 * Resolve the upstream origin for a design. Returns null rather than throwing
 * so a missing or non-builder-host design is a 404, not a 500.
 */
async function upstreamOriginFor(designId: string): Promise<string | null> {
  if (!designId) return null;
  const [row] = await getDb()
    .select({ data: schema.designs.data })
    .from(schema.designs)
    .where(eq(schema.designs.id, designId));
  if (!row) return null;

  const app = readFusionApp(row.data);
  if (app?.source !== "builder-host" || !app.previewUrl) return null;
  try {
    // Re-validate on read: a linkage written before the allowlist tightened
    // must not become a proxy target now.
    return parseBuilderPreviewUrl(app.previewUrl).origin;
    // coercion-ok: failing the allowlist means no upstream, which is a 404.
  } catch {
    return null;
  }
}

export async function proxyBuilderPreview(
  event: H3Event,
  args: { designId: string; path: string },
): Promise<unknown> {
  const origin = await upstreamOriginFor(args.designId);
  if (!origin) {
    setResponseStatus(event, 404);
    return { error: "No Builder preview is linked to this design." };
  }
  // Verbatim query: a dev server distinguishes `?astro&lang.css` from
  // `?astro=&lang.css=`, and re-encoding parsed params serves the wrong module.
  const target = new URL(args.path.replace(/^\/+/, ""), `${origin}/`);
  target.search = getRequestURL(event).search;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: { accept: getHeader(event, "accept") ?? "*/*" },
      // Never `follow`: the allowlist is checked on this URL only, so a
      // container that redirects elsewhere would fetch that origin through us.
      redirect: "manual",
    });
  } catch (error) {
    // A dead or sleeping container is a gateway failure, not a 500 here.
    setResponseStatus(event, 502);
    return {
      error: `Could not reach the Builder preview: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  for (const [key, value] of upstream.headers.entries()) {
    if (DROPPED_UPSTREAM_HEADERS.has(key.toLowerCase())) continue;
    setResponseHeader(event, key, value);
  }
  // A redirect within the container has to stay inside the proxy, or the frame
  // navigates to the container's own origin and stops being same-origin.
  const location = upstream.headers.get("location");
  if (location) {
    const resolved = new URL(location, target);
    setResponseHeader(
      event,
      "location",
      resolved.origin === origin
        ? `${builderPreviewProxyPath(args.designId, resolved.pathname)}${resolved.search}`
        : resolved.toString(),
    );
  }
  setResponseStatus(event, upstream.status);

  return Buffer.from(await upstream.arrayBuffer());
}

export const builderPreviewProxy = defineEventHandler(async (event) => {
  // One catch-all rather than `[designId]/[...path]`: the nested-param form is
  // not matched by the route scanner here and silently falls through to the SPA.
  const raw = (getRouterParam(event, "path") ?? "").replace(/^\/+/, "");
  const slash = raw.indexOf("/");
  const designId = decodeURIComponent(slash === -1 ? raw : raw.slice(0, slash));
  const path = slash === -1 ? "" : raw.slice(slash + 1);

  return proxyBuilderPreview(event, { designId, path });
});
