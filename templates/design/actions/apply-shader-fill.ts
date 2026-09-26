
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
  prepareInlineSourceEdit,
  SourceWorkspaceEditConflictError,
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


interface ResolvedDesignFile {
  id: string;
  designId: string;
  filename: string;
  fileType: string;
  content: string;
  versionHash: string;
  codeLayerSource: CodeLayerSource;
}

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
  const workspaceFile: SourceWorkspaceFile = {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    fileType: file.fileType,
    content: file.content,
    createdAt: null,
    updatedAt: file.updatedAt,
  };
  let prepared: Awaited<ReturnType<typeof prepareInlineSourceEdit>>;
  try {
    prepared = await prepareInlineSourceEdit({
      file: workspaceFile,
      currentContent: source.currentContent,
      revision: source.revision,
    });
  } catch (error) {
    if (error instanceof SourceWorkspaceEditConflictError) {
      throw new ShaderFillRevisionConflictError();
    }
    throw error;
  }

  return {
    id: file.id,
    designId: file.designId,
    filename: file.filename,
    fileType: file.fileType,
    content: prepared.content,
    versionHash: prepared.expectedVersionHash,
    codeLayerSource: {
      kind: "design-file",
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      revision: source.revision,
    },
  };
}

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
  run: async ({ descriptor: rawDescriptor, target, source }, context) => {
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

    const { background, colors } = buildShaderFillBackground(descriptor);
    const fallbackCss = generateShaderFillFallbackCss(descriptor);

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
    await snapshotDesignBeforeAgentEdit(file.designId, context);

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
