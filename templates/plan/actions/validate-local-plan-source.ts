import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { parsePlanMdxFolder, planMdxFileSchema } from "../server/plan-mdx.js";

/**
 * Authoritative validation for a local plan MDX folder.
 *
 * This runs the SAME `parsePlanMdxFolder` + `planContentSchema` the renderer
 * uses, so a `valid: true` result here means the Plan app will actually render
 * the folder — closing the "passed locally, broken when rendered" gap between
 * the hand-rolled `plan local check` lint and the real renderer schema.
 *
 * It is intentionally a pure parse: it accepts the posted MDX folder, never
 * reads `schema.plans`, never touches the filesystem, and never writes to the
 * database. That keeps it safe to expose without auth so the offline-friendly
 * `plan local verify` CLI can call it against a local or hosted Plan app.
 */

// Covers the CLI's 10 MiB raw asset cap (~13.3 MiB base64) plus MDX text, so
// large-but-valid plans still get authoritative validation instead of the lint.
const MAX_MDX_BYTES = 16 * 1024 * 1024;

type ValidationIssue = { path: string; message: string };

function formatZodPath(segments: Array<string | number>): string {
  let out = "";
  for (const segment of segments) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out ? `.${segment}` : segment;
  }
  return out;
}

function toValidationIssues(error: unknown): ValidationIssue[] {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues?: unknown }).issues)
  ) {
    const issues = (error as { issues: unknown[] }).issues;
    const mapped: ValidationIssue[] = [];
    for (const raw of issues) {
      if (!raw || typeof raw !== "object") continue;
      const issue = raw as { path?: unknown; message?: unknown };
      const path = Array.isArray(issue.path)
        ? formatZodPath(issue.path as Array<string | number>)
        : "";
      const message =
        typeof issue.message === "string" ? issue.message : "Invalid value";
      mapped.push({ path, message });
    }
    if (mapped.length > 0) return mapped;
  }
  return [
    {
      path: "",
      message: error instanceof Error ? error.message : String(error),
    },
  ];
}

export default defineAction({
  description:
    "Validate a local plan MDX folder against the live Plan renderer schema (parsePlanMdxFolder + planContentSchema). Returns { valid, issues } where issues carry the renderer's exact schema path (e.g. blocks[1].data.items[0].id). Use this to confirm a plan will render before handing it off — it is the authoritative check behind `plan local verify`. Pure parse: no database, filesystem, or schema.plans access.",
  schema: z.object({
    mdx: planMdxFileSchema.describe(
      "The plan MDX folder: plan.mdx plus optional canvas.mdx, prototype.mdx, .plan-state.json, and assets/.",
    ),
  }),
  http: { method: "POST" },
  readOnly: true,
  requiresAuth: false,
  // Route-level cap (413 before parse). 2x MAX_MDX_BYTES for JSON wire overhead;
  // run() still enforces the precise content limit.
  maxBodyBytes: MAX_MDX_BYTES * 2,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: false,
    title: "Validate Local Plan Source",
    description:
      "Validate a local plan MDX folder against the real renderer schema without touching the database.",
  },
  run: async (args) => {
    let totalBytes = 0;
    for (const value of Object.values(args.mdx)) {
      if (typeof value === "string") {
        totalBytes += Buffer.byteLength(value);
      } else if (value && typeof value === "object") {
        for (const asset of Object.values(value)) {
          if (typeof asset === "string") totalBytes += Buffer.byteLength(asset);
        }
      }
    }
    if (totalBytes > MAX_MDX_BYTES) {
      throw new Error(
        `Plan MDX folder is too large to validate (${totalBytes} bytes > ${MAX_MDX_BYTES}).`,
      );
    }

    try {
      await parsePlanMdxFolder(args.mdx);
      return { valid: true as const, issues: [] as ValidationIssue[] };
    } catch (error) {
      return { valid: false as const, issues: toValidationIssues(error) };
    }
  },
});
