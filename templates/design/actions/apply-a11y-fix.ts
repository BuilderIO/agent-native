/**
 * apply-a11y-fix — apply an inline accessibility remediation to a design's
 * SQL-backed HTML content.
 *
 * The Review panel surfaces a11y findings from `run-design-audit`. Many common
 * fixes — raising text contrast, enlarging a tap target, adding a
 * focus-visible ring — are ordinary style / class edits that the deterministic
 * edit engine (`applyVisualEdit`, also used by `apply-visual-edit`) can apply to
 * inline HTML. This action takes one such finding, derives the deterministic
 * edit via the shared `a11yFindingToEdit` mapping, applies it, and persists the
 * patched content. The canvas re-renders from the written content — no iframe
 * postMessage is needed.
 *
 * Fixes that need a new attribute (alt / aria-label) or a semantic/structural
 * rewrite are NOT expressible through the deterministic engine and remain
 * "real-app only": `a11yFindingToEdit` returns `null` for them and this action
 * reports them as not auto-fixable instead of writing.
 *
 * Access is gated: only an editor of the design may apply a fix.
 */

import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
  applyText,
  getText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { applyVisualEdit, type EditIntent } from "../shared/code-layer.js";
import {
  A11Y_FINDING_CATEGORIES,
  A11Y_FINDING_SEVERITIES,
  a11yFindingToEdit,
  type A11yFinding,
} from "../shared/design-review.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * The subset of an {@link A11yFinding} the fix needs. The full finding is
 * accepted (extra fields are stripped) so callers can forward what they already
 * have from `run-design-audit` / `get-design-review` verbatim.
 */
const findingSchema = z
  .object({
    id: z.string(),
    severity: z.enum(A11Y_FINDING_SEVERITIES),
    category: z.enum(A11Y_FINDING_CATEGORIES),
    message: z.string().default(""),
    detail: z.string().optional(),
    nodeId: z.string().optional(),
    selector: z.string().optional(),
    wcag: z.string().optional(),
    fixAvailable: z.boolean().optional(),
  })
  .superRefine((finding, ctx) => {
    if (!finding.nodeId && !finding.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeId"],
        message:
          "finding.nodeId or finding.selector is required to anchor the fix.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Live-content + resolve/persist helpers (mirrors apply-visual-edit's scoped path)
// ---------------------------------------------------------------------------

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  try {
    if (await hasCollabState(fileId)) {
      const live = await getText(fileId, "content");
      if (typeof live === "string") return live;
    }
  } catch {
    // Collab reads are best-effort; SQL content remains the fallback.
  }
  return storedContent;
}

async function resolveEditableDesignFile(source: {
  designId?: string;
  fileId?: string;
  filename?: string;
}): Promise<{
  id: string;
  designId: string;
  filename: string;
  content: string;
}> {
  if (!source.fileId && !source.designId) {
    throw new Error("designId or fileId is required.");
  }

  const db = getDb();
  const conditions = [
    accessFilter(schema.designs, schema.designShares),
    source.fileId
      ? eq(schema.designFiles.id, source.fileId)
      : eq(schema.designFiles.designId, source.designId ?? ""),
  ];
  if (!source.fileId) {
    conditions.push(
      eq(schema.designFiles.filename, source.filename ?? "index.html"),
    );
  }

  const [file] = await db
    .select({
      id: schema.designFiles.id,
      designId: schema.designFiles.designId,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
    })
    .from(schema.designFiles)
    .innerJoin(
      schema.designs,
      eq(schema.designFiles.designId, schema.designs.id),
    )
    .where(and(...conditions))
    .limit(1);

  if (!file) {
    throw new Error("Design HTML file not found.");
  }
  if (file.fileType !== "html") {
    throw new Error("Inline a11y fixes only support HTML files.");
  }
  if (source.designId && file.designId !== source.designId) {
    throw new Error(
      `designId "${source.designId}" does not match file "${file.id}"`,
    );
  }

  // Writes require editor access to the owning design.
  await assertAccess("design", file.designId, "editor");

  return {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    content: await liveContent(file.id, file.content ?? ""),
  };
}

async function persistDesignFileEdit(file: {
  id: string;
  designId: string;
  content: string;
}): Promise<void> {
  // Re-assert at the write boundary so the persist path is independently scoped.
  await assertAccess("design", file.designId, "editor");

  const db = getDb();
  const now = new Date().toISOString();

  agentEnterDocument(file.id);
  try {
    await db
      .update(schema.designFiles)
      .set({ content: file.content, updatedAt: now })
      .where(eq(schema.designFiles.id, file.id));

    if (await hasCollabState(file.id)) {
      await applyText(file.id, file.content, "content", "agent");
    } else {
      await seedFromText(file.id, file.content);
    }

    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, file.designId));
  } finally {
    agentLeaveDocument(file.id);
  }
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    "Apply one inline accessibility fix to a design's SQL-backed HTML. " +
    "Given an a11y finding from run-design-audit (with a nodeId or selector), " +
    "derives a deterministic style/class edit — raise text contrast, enlarge a " +
    "tap target, or add a focus-visible ring — and persists it via the same " +
    "edit engine as apply-visual-edit. Findings needing new attributes " +
    "(alt / aria-label) or semantic/structural rewrites are not auto-fixable " +
    "and are reported as such (no write). Editor access required.",
  schema: z.object({
    designId: z
      .string()
      .optional()
      .describe(
        "Design project id. Required unless fileId is provided. Combined with " +
          "filename to resolve the HTML file to patch.",
      ),
    fileId: z
      .string()
      .optional()
      .describe(
        "Specific design_files.id to patch. Takes priority over designId/filename.",
      ),
    filename: z
      .string()
      .optional()
      .default("index.html")
      .describe(
        "Filename to patch when fileId is not provided. Defaults to index.html.",
      ),
    finding: findingSchema.describe(
      "The a11y finding to fix. Must carry a nodeId or selector to anchor the edit.",
    ),
    color: z
      .string()
      .optional()
      .describe(
        "Optional replacement foreground color (e.g. '#111827') for contrast " +
          "fixes. When omitted, a high-contrast near-black default is used.",
      ),
    includeContent: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include the patched HTML content in the response."),
  }),
  run: async ({
    designId,
    fileId,
    filename,
    finding,
    color,
    includeContent,
  }) => {
    const plan = a11yFindingToEdit(finding as A11yFinding, { color });

    if (!plan) {
      return {
        applied: false,
        autoFixable: false,
        reason:
          `Finding "${finding.id}" (${finding.category}) is not auto-fixable ` +
          "inline — it needs a new attribute (alt / aria-label) or a semantic " +
          "change that the deterministic edit engine cannot apply. Resolve it " +
          "in the real app or via the agent instead.",
        finding,
      };
    }

    const file = await resolveEditableDesignFile({
      designId,
      fileId,
      filename,
    });

    const patch = applyVisualEdit(file.content, plan.edit as EditIntent, {
      source: {
        kind: "design-file",
        designId: file.designId,
        fileId: file.id,
        filename: file.filename,
      },
    });

    if (patch.result.target) {
      agentUpdateSelection(file.id, {
        selection: patch.result.target.selector,
        nodeId: patch.result.target.nodeId,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    const persisted = patch.result.status === "applied" && patch.result.changed;
    if (persisted) {
      await persistDesignFileEdit({
        id: file.id,
        designId: file.designId,
        content: patch.content,
      });
    }

    return {
      applied: persisted,
      autoFixable: true,
      fixLabel: plan.label,
      edit: plan.edit,
      result: patch.result,
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      finding,
      persisted,
      patchedContent: includeContent ? patch.content : undefined,
      bytesBefore: file.content.length,
      bytesAfter: patch.content.length,
    };
  },
});
