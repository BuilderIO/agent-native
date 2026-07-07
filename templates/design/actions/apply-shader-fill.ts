/**
 * apply-shader-fill — PERSISTING apply action.
 *
 * Writes the chosen shader fill onto a design element as a CSS `background`,
 * the same gradient the preview renders. This is the deliberate commit step
 * after `preview-shader-fill`; preview stays non-persisting.
 *
 * Safety model (this action is SAFETY-gated, not Builder-gated):
 * - Editor access is asserted on the target design before any write
 *   (`accessFilter` on the read + `assertAccess("design", id, "editor")`).
 * - Only HTML design-file sources are writable — the deterministic HTML editor
 *   (`applyVisualEdit`) is the single mutation seam, exactly like
 *   `apply-visual-edit`. localhost / fusion / inline-html sources are NOT
 *   written; the caller gets the preview + an explanation instead.
 * - The persisted value is a CSS `background` produced by
 *   `buildShaderFillBackground`, which runs every colour through the same strict
 *   CSS-colour allowlist that `preview-shader-fill` uses (`shader-fill.ts`), so a
 *   `descriptor.colors` payload can never inject CSS into the source.
 * - The descriptor is validated against the preset manifest first, so callers
 *   get clear errors before any round-trip.
 *
 * The write persists durable SQL content directly. The edit is a single
 * inline-style `style.background` change on the resolved node — no structural
 * inserts, no new owned rows.
 *
 * Plan reference: DESIGN-STUDIO-PLAN.md §6.7 + §7 (shader fill apply).
 */

import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  applyVisualEdit,
  type CodeLayerSource,
  type StyleEditIntent,
} from "../shared/code-layer.js";
import {
  buildShaderFillBackground,
  generateShaderFillFallbackCss,
  generateShaderFillPreviewCss,
} from "../shared/shader-fill.js";
import {
  SHADER_PRESET_MAP,
  type ShaderDescriptor,
  type ShaderPresetName,
  validateDescriptor,
} from "../shared/shader-presets.js";
import { sourceContentHash } from "../shared/source-workspace.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const PRESET_NAMES = Object.keys(SHADER_PRESET_MAP) as [
  ShaderPresetName,
  ...ShaderPresetName[],
];
const REVISION_CONFLICT_MESSAGE =
  "This file changed since this shader fill was previewed. Refresh the editor and try again.";

class ShaderFillRevisionConflictError extends Error {
  constructor() {
    super(REVISION_CONFLICT_MESSAGE);
    this.name = "ShaderFillRevisionConflictError";
  }
}

const descriptorSchema = z.object({
  preset: z
    .enum(PRESET_NAMES)
    .describe("Shader preset name. One of: " + PRESET_NAMES.join(", ")),
  params: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
    .optional()
    .default({})
    .describe("Shader-specific params. Merged with preset defaults."),
  colors: z
    .array(z.string())
    .optional()
    .describe(
      "Colour palette override. Falls back to preset defaults. Every colour " +
        "is validated against a strict CSS-colour allowlist before it is " +
        "written; unsafe entries are neutralised, never injected.",
    ),
  speed: z.number().optional(),
  frame: z.number().optional(),
  fit: z.enum(["none", "contain", "cover"]).optional(),
  scale: z.number().optional(),
  rotation: z.number().optional().describe("Rotation in radians."),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

const sourceSchema = z
  .object({
    kind: z
      .enum(["design-file", "inline-html", "localhost", "fusion"])
      .default("design-file"),
    designId: z.string().optional(),
    fileId: z.string().optional(),
    filename: z.string().optional(),
    revision: z.string().optional(),
    currentContent: z
      .string()
      .optional()
      .describe(
        "Current open editor HTML for the target file. When supplied, the " +
          "shader background is patched into this content instead of the " +
          "last SQL snapshot so in-flight local edits are preserved. " +
          "source.revision must also be supplied as the file updatedAt value " +
          "that currentContent was based on.",
      ),
  })
  .describe(
    "Design source. Only kind=design-file (HTML) is persisted. Provide " +
      "designId (and optional filename) or fileId.",
  );

const targetSchema = z
  .object({
    nodeId: z.string().optional(),
    selector: z.string().optional(),
  })
  .superRefine((target, ctx) => {
    if (!target.nodeId && !target.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeId"],
        message: "target.nodeId or target.selector is required",
      });
    }
  })
  .describe(
    "Target element by nodeId (data-agent-native-node-id) or selector.",
  );

// ─── Persist helpers (mirrors apply-visual-edit.ts) ───────────────────────────

interface ResolvedDesignFile {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content: string;
  /** versionHash of `content` — the exact base the transform reads from. */
  versionHash: string;
  codeLayerSource: CodeLayerSource;
}

/**
 * Resolve the target HTML design file with an access-scoped read, then assert
 * editor access. Mirrors `resolveEditableDesignFile` in apply-visual-edit.ts so
 * the shader-fill write goes through the exact same ownership gate.
 *
 * The editable base is collab-aware: `readLiveSourceFile` returns the live
 * Y.Text content when a collab doc exists for this file, else the SQL row —
 * never only the raw SQL snapshot. When the caller supplies
 * `source.currentContent`, that in-flight editor snapshot is preferred as the
 * base instead (same precedence as apply-motion-edit.ts / apply-component-
 * prop-edit.ts), and its versionHash is computed directly from that exact
 * string via `sourceContentHash` — not from a fresh live re-read, which would
 * prove nothing about whether this specific base is still current.
 */
async function resolveEditableDesignFile(source: {
  designId?: string;
  fileId?: string;
  filename?: string;
  revision?: string;
  currentContent?: string;
}): Promise<ResolvedDesignFile> {
  if (!source.fileId && !source.designId) {
    throw new Error(
      "source.designId or source.fileId is required for design-file.",
    );
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
      updatedAt: schema.designFiles.updatedAt,
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
    throw new Error(
      "Shader fills can only be persisted onto HTML design files for now.",
    );
  }
  if (source.designId && file.designId !== source.designId) {
    throw new Error(
      `source.designId "${source.designId}" does not match file "${file.id}"`,
    );
  }
  if (!source.fileId && source.filename && file.filename !== source.filename) {
    throw new Error(
      `source.filename "${source.filename}" does not match file "${file.id}"`,
    );
  }

  await assertAccess("design", file.designId, "editor");

  if (source.currentContent !== undefined && !source.revision) {
    throw new Error(
      "source.revision is required when source.currentContent is provided.",
    );
  }
  // Legitimate pre-check, distinct from the CAS write-guard below: reject
  // early when the caller's own revision stamp doesn't match the file's SQL
  // updatedAt, before any transform work happens.
  if (
    source.currentContent !== undefined &&
    source.revision &&
    file.updatedAt &&
    source.revision !== file.updatedAt
  ) {
    throw new ShaderFillRevisionConflictError();
  }

  let content: string;
  let versionHash: string;
  if (source.currentContent !== undefined) {
    content = source.currentContent;
    versionHash = sourceContentHash(content);
  } else {
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename,
      fileType: file.fileType,
      content: file.content,
      createdAt: null,
      updatedAt: file.updatedAt,
    };
    const live = await readLiveSourceFile(workspaceFile);
    content = live.content;
    versionHash = live.versionHash;
  }

  return {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    fileType: file.fileType,
    content,
    versionHash,
    codeLayerSource: {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      revision: source.revision,
    },
  };
}

/**
 * Persist the patched HTML through the collab-aware seam
 * (`writeInlineSourceFile`), conditioned on the versionHash of the SAME base
 * the `applyVisualEdit` transform used — not a fresh re-read/re-check at
 * persist time. `writeInlineSourceFile` re-reads the live text immediately
 * before its own write and throws "Source file changed since it was read..."
 * if it no longer matches; callers map that rejection to the existing
 * `ShaderFillRevisionConflictError`-shaped response (see run()'s catch block).
 */
async function persistDesignFileEdit(file: {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content: string;
  expectedVersionHash: string;
}): Promise<string> {
  agentEnterDocument(file.id);
  try {
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename,
      fileType: file.fileType,
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };
    const result = await writeInlineSourceFile({
      designId: file.designId,
      file: workspaceFile,
      content: file.content,
      expectedVersionHash: file.expectedVersionHash,
    });
    return result.updatedAt;
  } catch (error) {
    if (
      error instanceof Error &&
      /changed since it was read/.test(error.message)
    ) {
      throw new ShaderFillRevisionConflictError();
    }
    throw error;
  } finally {
    agentLeaveDocument(file.id);
  }
}

// ─── Action ──────────────────────────────────────────────────────────────────

export default defineAction({
  description: `
Persist a shader fill onto a design element as a CSS \`background\`.

This is the commit step after preview-shader-fill. It writes the same gradient
the preview renders onto the target element's inline style.background, using the
deterministic HTML editor (the same persist path as apply-visual-edit).

Gating: editor access on the target design is asserted before any write. Only
HTML design-file sources are persisted; localhost / fusion / inline-html sources
return the preview CSS plus an explanation and write nothing. Every colour is
validated against the shared CSS-colour allowlist before it is written, so a
descriptor.colors payload can never inject CSS into the source.

Returns:
- persisted     — true only when the source HTML was actually changed and saved.
- background    — the CSS \`background\` value written (or that would be written).
- fallbackCss   — a simpler static CSS background for export / PDF / SSR.
- descriptor    — the resolved and validated ShaderDescriptor.
- result        — the deterministic edit PatchResult (status, target, message).
- bytesBefore / bytesAfter — proof-of-change for the persisted file.

To preview without writing, call preview-shader-fill. To get a manual-edit code
snippet (WebGL canvas / JSX component), call apply-shader.
  `.trim(),
  schema: z.object({
    descriptor: descriptorSchema.describe("Shader preset + params to persist."),
    target: targetSchema,
    source: sourceSchema,
  }),
  run: async ({ descriptor: rawDescriptor, target, source }) => {
    const descriptor: ShaderDescriptor = {
      preset: rawDescriptor.preset as ShaderPresetName,
      params: rawDescriptor.params ?? {},
      colors: rawDescriptor.colors,
      speed: rawDescriptor.speed,
      frame: rawDescriptor.frame,
      fit: rawDescriptor.fit,
      scale: rawDescriptor.scale,
      rotation: rawDescriptor.rotation,
      offsetX: rawDescriptor.offsetX,
      offsetY: rawDescriptor.offsetY,
    };

    // Validate against the preset manifest before any write so the caller gets
    // clear errors without a wasted DB / collab round-trip.
    const validation = validateDescriptor(descriptor);
    if (!validation.valid) {
      return {
        ok: false,
        persisted: false,
        errors: validation.errors,
        descriptor,
        hint: "Fix the descriptor errors and retry. Call get-shader to see the full preset catalog.",
      };
    }

    // Resolve the CSS `background` to write. Every colour is run through the
    // strict CSS-colour allowlist here (same path preview-shader-fill uses).
    const { background, colors } = buildShaderFillBackground(descriptor);
    const fallbackCss = generateShaderFillFallbackCss(descriptor);

    // Only HTML design-file sources are persisted. Everything else gets the
    // preview value plus an explanation and writes nothing — the deterministic
    // HTML editor is the single safe mutation seam.
    if (source.kind !== "design-file") {
      return {
        ok: true,
        persisted: false,
        descriptor,
        background: generateShaderFillPreviewCss(descriptor),
        fallbackCss,
        colors,
        note:
          `Shader fills are only persisted onto HTML design-file sources. ` +
          `Source kind "${source.kind}" was not written. Inject the returned ` +
          `background via the bridge for a live preview, or call apply-shader ` +
          `for a manual-edit code snippet.`,
      };
    }

    let file: ResolvedDesignFile;
    try {
      file = await resolveEditableDesignFile(source);
    } catch (error) {
      if (error instanceof ShaderFillRevisionConflictError) {
        return {
          ok: false,
          persisted: false,
          conflict: true,
          descriptor,
          background,
          fallbackCss,
          colors,
          error: error.message,
          note: error.message,
        };
      }
      throw error;
    }

    const intent: StyleEditIntent = {
      kind: "style",
      target: { nodeId: target.nodeId, selector: target.selector },
      property: "background",
      value: background,
    };

    const patch = applyVisualEdit(file.content, intent, {
      source: file.codeLayerSource,
    });

    if (patch.result.target) {
      agentUpdateSelection(file.id, {
        selection: patch.result.target.selector,
        nodeId: patch.result.target.nodeId,
        editingFile: file.filename,
        designId: file.designId,
      });
    }

    const changed =
      patch.result.status === "applied" && patch.result.changed === true;
    let updatedAt: string | undefined;

    if (changed) {
      try {
        updatedAt = await persistDesignFileEdit({
          id: file.id,
          designId: file.designId,
          filename: file.filename,
          fileType: file.fileType,
          content: patch.content,
          expectedVersionHash: file.versionHash,
        });
      } catch (error) {
        if (error instanceof ShaderFillRevisionConflictError) {
          return {
            ok: false,
            persisted: false,
            conflict: true,
            descriptor,
            background,
            fallbackCss,
            colors,
            designId: file.designId,
            fileId: file.id,
            filename: file.filename,
            result: patch.result,
            error: error.message,
            note: error.message,
          };
        }
        throw error;
      }
    }

    return {
      ok: patch.result.status === "applied",
      persisted: changed,
      descriptor,
      background,
      fallbackCss,
      colors,
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      updatedAt,
      result: patch.result,
      patchedContent: patch.content,
      bytesBefore: file.content.length,
      bytesAfter: patch.content.length,
      note: changed
        ? "Shader fill persisted as the element's CSS background."
        : "No change was written — the deterministic editor could not apply the edit. See result for details.",
    };
  },
});
