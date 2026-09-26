
import { defineAction } from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import { applyVisualEdit, type EditIntent } from "../shared/code-layer.js";
import { agentSelectionDescriptor } from "../shared/collab-selection.js";
import {
  A11Y_FINDING_CATEGORIES,
  A11Y_FINDING_SEVERITIES,
  a11yFindingToEdit,
  type A11yFinding,
} from "../shared/design-review.js";


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


async function resolveEditableDesignFile(source: {
  designId?: string;
  fileId?: string;
  filename?: string;
}): Promise<{
  id: string;
  designId: string;
  filename: string;
  content: string;
  versionHash: string;
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

  await assertAccess("design", file.designId, "editor");

  const workspaceFile: SourceWorkspaceFile = {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    fileType: "html",
    content: file.content ?? "",
    createdAt: null,
    updatedAt: null,
  };
  const live = await readLiveSourceFile(workspaceFile);

  return {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    content: live.content,
    versionHash: live.versionHash,
  };
}

async function persistDesignFileEdit(file: {
  id: string;
  designId: string;
  filename: string;
  content: string;
  expectedVersionHash: string;
}): Promise<void> {
  await assertAccess("design", file.designId, "editor");

  agentEnterDocument(file.id);
  try {
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename,
      fileType: "html",
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };

    await writeInlineSourceFile({
      designId: file.designId,
      file: workspaceFile,
      content: file.content,
      expectedVersionHash: file.expectedVersionHash,
    });
  } finally {
    agentLeaveDocument(file.id);
  }
}


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
  run: async (
    { designId, fileId, filename, finding, color, includeContent },
    context,
  ) => {
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
    await snapshotDesignBeforeAgentEdit(file.designId, context);

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
        selection: agentSelectionDescriptor(
          patch.result.target,
          "Fixing accessibility",
        ),
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
        filename: file.filename,
        content: patch.content,
        expectedVersionHash: file.versionHash,
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
