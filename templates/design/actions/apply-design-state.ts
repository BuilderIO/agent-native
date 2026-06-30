import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

/**
 * Maximum serialised size of a replayed `captureData` payload. Captured DOM
 * snapshots are arbitrary caller markup; cap them so a single state can't bloat
 * the design row (and the shareable content it feeds).
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
 * contains an angle-bracket tag opener or a close tag. Plain data strings
 * (route names, ids) are left untouched.
 */
function looksLikeMarkup(value: string): boolean {
  return /<[a-zA-Z!/]/.test(value) || value.includes("</");
}

/**
 * Recursively sanitise every string value inside a replayed state payload
 * (e.g. `domHtml`, `domSnapshot`, `x-data` markup) so no untrusted DOM is
 * persisted raw. Non-string leaves pass through unchanged.
 */
function sanitizeStatePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return looksLikeMarkup(value) ? sanitizeMarkup(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeStatePayload(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeStatePayload(v);
    }
    return out;
  }
  return value;
}

export default defineAction({
  description:
    "Update (apply) changes to an existing design state row. " +
    "Supports renaming, changing breakpoint, updating fixture/capture data, " +
    "and setting the preview reference. All fields are optional; only provided " +
    "fields are updated.",
  schema: z.object({
    id: z.string().describe("design_state row id to update"),
    designId: z
      .string()
      .describe(
        "Design project ID (required for access check; must match the state's design_id).",
      ),
    name: z.string().min(1).optional().describe("Rename the state."),
    breakpoint: z
      .enum(["auto", "desktop", "tablet", "mobile"])
      .optional()
      .describe("Change the breakpoint context."),
    route: z
      .string()
      .optional()
      .nullable()
      .describe("Update the associated app route path."),
    fixtureData: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .optional()
      .nullable()
      .describe("Replace the fixture data payload."),
    captureData: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .optional()
      .nullable()
      .describe("Replace the capture data payload."),
    previewRef: z
      .string()
      .optional()
      .nullable()
      .describe("Update the preview snapshot reference."),
  }),
  run: async ({
    id,
    designId,
    name,
    breakpoint,
    route,
    fixtureData,
    captureData,
    previewRef,
  }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    // Verify the row belongs to this design before updating.
    const [existing] = await db
      .select({ id: schema.designState.id })
      .from(schema.designState)
      .where(
        and(
          eq(schema.designState.id, id),
          eq(schema.designState.designId, designId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error(
        `design_state row '${id}' not found for design '${designId}'.`,
      );
    }

    const patch: Record<string, unknown> = { updatedAt: now };
    if (name !== undefined) patch.name = name;
    if (breakpoint !== undefined) patch.breakpoint = breakpoint;
    if (route !== undefined) patch.route = route;
    if (fixtureData !== undefined) {
      // Sanitise replayed markup (stored-XSS guard) before persisting.
      if (fixtureData !== null) {
        const fixtureDataJson = JSON.stringify(
          sanitizeStatePayload(fixtureData),
        );
        if (
          Buffer.byteLength(fixtureDataJson, "utf8") > CAPTURE_DATA_MAX_BYTES
        ) {
          throw new Error(
            `fixtureData exceeds the ${Math.round(
              CAPTURE_DATA_MAX_BYTES / 1024,
            )}KB limit. Trim the payload before updating this fixture.`,
          );
        }
        patch.fixtureData = fixtureDataJson;
      } else {
        patch.fixtureData = null;
      }
    }
    if (captureData !== undefined) {
      if (captureData !== null) {
        // Sanitise replayed DOM/markup and enforce a size cap so a single state
        // can't bloat the row / the shareable content it feeds.
        const captureDataJson = JSON.stringify(
          sanitizeStatePayload(captureData),
        );
        if (
          Buffer.byteLength(captureDataJson, "utf8") > CAPTURE_DATA_MAX_BYTES
        ) {
          throw new Error(
            `captureData exceeds the ${Math.round(
              CAPTURE_DATA_MAX_BYTES / 1024,
            )}KB limit. Use a smaller DOM snapshot or trim the payload.`,
          );
        }
        patch.captureData = captureDataJson;
      } else {
        patch.captureData = null;
      }
    }
    if (previewRef !== undefined) patch.previewRef = previewRef;

    await db
      .update(schema.designState)
      .set(patch)
      .where(
        and(
          eq(schema.designState.id, id),
          eq(schema.designState.designId, designId),
        ),
      );

    return {
      id,
      designId,
      updatedAt: now,
      updated: Object.keys(patch).filter((k) => k !== "updatedAt"),
    };
  },
});
