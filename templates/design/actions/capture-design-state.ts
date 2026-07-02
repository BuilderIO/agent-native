import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { hasCapability } from "../shared/design-source-capabilities.js";
import type { DesignSourceCapabilities } from "../shared/design-source-capabilities.js";
import {
  normalizeDesignSourceType,
  resolveDescriptorCapabilities,
  type DesignSourceDescriptor,
} from "../shared/source-mode.js";

/**
 * Resolve the capabilities for the design's source type.
 * Falls back to inline capabilities when not present in stored data.
 */
function resolveCapabilities(
  designData: string | null,
): DesignSourceCapabilities {
  if (!designData) {
    return resolveDescriptorCapabilities({ sourceType: "inline" });
  }

  try {
    const parsed = JSON.parse(designData) as Record<string, unknown>;
    if (parsed.capabilities && typeof parsed.capabilities === "object") {
      return parsed.capabilities as DesignSourceCapabilities;
    }
    const sourceType = normalizeDesignSourceType(parsed.sourceType) ?? "inline";
    const descriptor: DesignSourceDescriptor =
      sourceType === "fusion"
        ? { sourceType, connected: parsed.connected === true }
        : sourceType === "localhost"
          ? {
              sourceType,
              connectionId:
                typeof parsed.connectionId === "string"
                  ? parsed.connectionId
                  : "unknown",
            }
          : { sourceType };
    return resolveDescriptorCapabilities(descriptor);
  } catch {
    // ignore parse errors
  }

  return resolveDescriptorCapabilities({ sourceType: "inline" });
}

/**
 * Maximum serialised size of a captured/replayed `captureData` payload.
 * Captured DOM snapshots are arbitrary caller markup; cap them so a single
 * capture can't bloat the design row (and the shareable content it feeds).
 */
const CAPTURE_DATA_MAX_BYTES = 256 * 1024; // 256KB

/**
 * Strip stored-XSS vectors out of an HTML/markup string before it is persisted
 * and later replayed into shareable design content. Mirrors the framework's
 * text-edit HTML sanitiser: removes script/style/iframe/object/embed/link/meta/
 * base tags, inline `on*` handlers, and `javascript:` / `vbscript:` / `data:`
 * URLs in `href` / `src` / `xlink:href`.
 */
function sanitizeMarkup(html: string): string {
  return html
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|base)\b[^>]*\/?\s*>/gi,
      "",
    )
    .replace(/\s+on[A-Za-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, "")
    .replace(
      /\s+(href|src|xlink:href)\s*=\s*(?:(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2|(?:javascript|vbscript|data):[^\s>]*)/gi,
      "",
    );
}

/**
 * A string "looks like markup" — and is therefore worth sanitising — when it
 * contains an angle-bracket tag opener or an Alpine `x-`/`@`/`:` binding that
 * could carry script. Plain data strings (route names, ids) are left untouched.
 */
function looksLikeMarkup(value: string): boolean {
  return /<[a-zA-Z!/]/.test(value) || value.includes("</");
}

/**
 * Recursively sanitise every string value inside a captured/replayed
 * `captureData` object (e.g. `domHtml`, `domSnapshot`, `x-data` markup) so no
 * untrusted DOM is persisted raw. Non-string leaves pass through unchanged.
 */
function sanitizeCaptureData(value: unknown): unknown {
  if (typeof value === "string") {
    return looksLikeMarkup(value) ? sanitizeMarkup(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeCaptureData(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeCaptureData(v);
    }
    return out;
  }
  return value;
}

export default defineAction({
  description:
    "Capture the running app's current route, props, and API data into a " +
    "design_state row of kind 'capture'. Requires the design's source to " +
    "advertise the 'captureState' capability (localhost and fusion tiers). " +
    "The bridge's captureState operation is called and the result is persisted " +
    "as a new design state that can be loaded in the States panel. " +
    "For inline designs without a live bridge, use create-design-state instead.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    name: z
      .string()
      .min(1)
      .describe(
        "Human-readable label for the captured state (e.g. 'Checkout – empty cart', 'Profile – logged in').",
      ),
    breakpoint: z
      .enum(["auto", "desktop", "tablet", "mobile"])
      .default("auto")
      .describe("Breakpoint context active at the time of capture."),
    sourceRef: z
      .string()
      .optional()
      .describe(
        "Source connection ref (routeId for localhost/fusion). Omit if the design has only one source.",
      ),
    route: z
      .string()
      .optional()
      .describe("App route path at capture time (e.g. '/checkout')."),
    captureData: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .describe(
        "The payload returned by the bridge captureState op — typically " +
          "{ route, props, queryParams, apiResponses, domSnapshot }. " +
          "The caller (UI or agent) must have already invoked the bridge and pass the result here.",
      ),
    previewRef: z
      .string()
      .optional()
      .describe(
        "Snapshot image URL or design_version id produced immediately before " +
          "or after the capture (optional).",
      ),
  }),
  run: async ({
    designId,
    name,
    breakpoint,
    sourceRef,
    route,
    captureData,
    previewRef,
  }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();

    // Capability gate — captureState must be available for this design source.
    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);

    if (!design) {
      throw new Error(`Design '${designId}' not found.`);
    }

    const caps = resolveCapabilities(design.data);
    if (!hasCapability(caps, "captureState")) {
      throw new Error(
        "The design's source does not support captureState. " +
          "Connect Builder or a localhost bridge to enable live captures.",
      );
    }

    const id = nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    // Sanitise captured DOM/markup (stored-XSS guard) and enforce a size cap so
    // a single capture can't bloat the row / the shareable content it feeds.
    const sanitizedCaptureData = sanitizeCaptureData(captureData);
    const captureDataJson = JSON.stringify(sanitizedCaptureData);
    if (Buffer.byteLength(captureDataJson, "utf8") > CAPTURE_DATA_MAX_BYTES) {
      throw new Error(
        `captureData exceeds the ${Math.round(
          CAPTURE_DATA_MAX_BYTES / 1024,
        )}KB limit. Capture a smaller DOM snapshot or trim the payload.`,
      );
    }

    await db.insert(schema.designState).values({
      id,
      designId,
      sourceRef: sourceRef ?? null,
      name,
      kind: "capture",
      breakpoint,
      route: route ?? null,
      fixtureData: null,
      captureData: captureDataJson,
      previewRef: previewRef ?? null,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
    });

    return {
      id,
      designId,
      name,
      kind: "capture",
      breakpoint,
      route: route ?? null,
      sourceRef: sourceRef ?? null,
      previewRef: previewRef ?? null,
      createdAt: now,
    };
  },
});
