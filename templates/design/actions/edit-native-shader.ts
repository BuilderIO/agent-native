import { defineAction, fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  loadSelectedSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
  SourceWorkspaceEditConflictError,
  writeInlineSourceFile,
} from "../server/source-workspace.js";
import {
  editNativeEffectHtml,
  type NativeEffectEdit,
} from "../shared/native-effect-edits.js";
import {
  hashEffectDefinition,
  MAX_APPROVED_NATIVE_DEFINITION_HASHES,
  NativeEffectApprovalStateError,
  nativeEffectApprovalKey,
  parseNativeEffectApprovalState,
} from "../shared/native-effect-trust.js";
import {
  MAX_EFFECT_MANIFEST_BYTES,
  parseEffectsFromHtml,
} from "../shared/native-effects.js";
import {
  isNativeSourceSizing,
  type NativeSourceSizing,
} from "../shared/native-source-sizing.js";
import { isFiniteNativeUniformTiming } from "../shared/native-uniform-timing.js";
import { previewSourceDiff } from "../shared/source-workspace.js";

const values = z.record(z.string(), z.unknown());
const definition = z.unknown();
const sourceSizing = z.custom<NativeSourceSizing>(isNativeSourceSizing);
const presetTiming = z
  .object({
    speed: z.number().finite().min(0).refine(isFiniteNativeUniformTiming),
    paused: z.boolean(),
    time: z.number().finite().min(0).refine(isFiniteNativeUniformTiming),
  })
  .strict();
const operation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("apply"),
    nodeId: z.string().min(1),
    placement: z.enum(["fill", "layer", "backdrop"]),
    definitionId: z.string().optional(),
    definitionVersion: z.number().int().positive().optional(),
    definition: definition.optional(),
    params: values.optional(),
    clip: z.enum(["bounds", "text"]).optional(),
    bindings: z.unknown().optional(),
    transform: z.unknown().optional(),
    sourceSizing: sourceSizing.optional(),
    timing: presetTiming.optional(),
  }),
  z.object({
    kind: z.literal("apply-many"),
    nodeIds: z.array(z.string().min(1)).min(2).max(32),
    placement: z.enum(["fill", "layer", "backdrop"]),
    definitionId: z.string().optional(),
    definitionVersion: z.number().int().positive().optional(),
    definition: definition.optional(),
    params: values.optional(),
    clip: z.enum(["bounds", "text"]).optional(),
    bindings: z.unknown().optional(),
    transform: z.unknown().optional(),
    sourceSizing: sourceSizing.optional(),
    sourceSizingByNodeId: z.record(z.string().min(1), sourceSizing).optional(),
    timing: presetTiming.optional(),
  }),
  z.object({
    kind: z.literal("apply-preset"),
    nodeId: z.string().min(1),
    presetId: z.string().min(1),
    params: values.optional(),
    sourceSizing: sourceSizing.optional(),
  }),
  z.object({
    kind: z.literal("set-params"),
    instanceId: z.string(),
    params: values,
  }),
  z.object({
    kind: z.literal("set-params-many"),
    instanceIds: z.array(z.string().min(1)).min(2).max(32),
    params: values,
  }),
  z.object({
    kind: z.literal("set-instance"),
    instanceId: z.string(),
    enabled: z.boolean().optional(),
    opacity: z.number().optional(),
    seed: z.number().int().min(0).max(1_000_000).optional(),
    clip: z.enum(["bounds", "text"]).optional(),
    placement: z.enum(["fill", "layer", "backdrop"]).optional(),
    bindings: z.unknown().nullable().optional(),
    transform: z.unknown().nullable().optional(),
    sourceSizing: sourceSizing.nullable().optional(),
  }),
  z.object({
    kind: z.literal("playback"),
    instanceId: z.string(),
    speed: z.number().min(0).refine(isFiniteNativeUniformTiming).optional(),
    paused: z.boolean().optional(),
    time: z.number().min(0).refine(isFiniteNativeUniformTiming).optional(),
    seekRevision: z.number().int().min(0).max(1_000_000).optional(),
  }),
  z.object({ kind: z.literal("reset-instance"), instanceId: z.string() }),
  z.object({
    kind: z.literal("set-preview"),
    preview: z
      .object({
        quality: z.enum(["auto", "performance", "quality"]),
        frameRateTarget: z.union([z.literal(60), z.literal(120)]),
        colorMode: z.enum(["srgb", "display-p3"]).optional(),
        dynamicRange: z.enum(["sdr", "hdr"]).optional(),
      })
      .strict()
      .nullable(),
  }),
  z.object({ kind: z.literal("duplicate"), instanceId: z.string() }),
  z.object({
    kind: z.literal("reorder"),
    instanceId: z.string(),
    beforeInstanceId: z.string().nullable(),
  }),
  z.object({ kind: z.literal("remove"), instanceId: z.string() }),
  z.object({ kind: z.literal("save-preset"), preset: z.unknown() }),
  z.object({ kind: z.literal("remove-preset"), presetId: z.string().min(1) }),
  z.object({
    kind: z.literal("approve-definition"),
    definitionId: z.string().min(1),
    definitionVersion: z.number().int().positive(),
    expectedExecutionHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    kind: z.literal("revoke-definition"),
    executionHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    kind: z.literal("revise-definition"),
    definition,
    fromVersion: z.number().int().positive(),
    instanceIds: z.array(z.string()).min(1),
    params: values.optional(),
  }),
]);

export default defineAction({
  description:
    "Edit a native v2 GPU effect in one inline Design HTML file, or approve/revoke an exact executable definition hash for the signed-in viewer. " +
    "Source edits, including document preview quality, frame-rate, requested color gamut, and dynamic-range policy, require editor access and an expected version hash; approvals require view access and change only viewer-scoped application state. " +
    "CPU validation does not compile GPU code; verify rendering in the Design preview.",
  requiresAuth: true,
  maxBodyBytes: MAX_EFFECT_MANIFEST_BYTES + 16_384,
  schema: z.object({
    designId: z.string().min(1),
    fileId: z.string().min(1),
    expectedVersionHash: z.string().min(1),
    operation,
  }),
  run: async (
    { designId, fileId, expectedVersionHash, operation },
    context,
  ) => {
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: false,
      includeBoard: true,
    });
    if (workspace.sourceType !== "inline") {
      fail("This Design source is not editable as inline HTML.", {
        errorCode: "native_effect_not_editable",
        statusCode: 403,
      });
    }
    if (
      !workspace.canEdit &&
      operation.kind !== "approve-definition" &&
      operation.kind !== "revoke-definition"
    ) {
      fail("Editing native effects requires Design editor access.", {
        errorCode: "native_effect_not_editable",
        statusCode: 403,
      });
    }
    const file = workspace.files.find((candidate) => candidate.id === fileId);
    if (!file)
      fail("Design source file not found.", {
        errorCode: "native_effect_file_not_found",
        statusCode: 404,
      });
    if (file.fileType !== "html") {
      fail("Native effects require an inline HTML source file.", {
        errorCode: "native_effect_non_html",
        statusCode: 400,
      });
    }
    const selectedWithContent = await loadSelectedSourceWorkspaceFile(file);
    if (!selectedWithContent)
      fail("Design source file not found.", {
        errorCode: "native_effect_file_not_found",
        statusCode: 404,
      });
    const live = await readLiveSourceFile(selectedWithContent);
    if (live.versionHash !== expectedVersionHash) {
      fail("Source file changed since it was read. Re-read and retry.", {
        errorCode: "native_effect_stale_source",
        statusCode: 409,
      });
    }
    if (
      operation.kind === "approve-definition" ||
      operation.kind === "revoke-definition"
    ) {
      const parsed = parseEffectsFromHtml(live.content);
      if (parsed.errors.length)
        fail(
          `Native effect manifest is unreadable: ${parsed.errors.join("; ")}`,
          {
            errorCode: "native_effect_manifest_unreadable",
            statusCode: 422,
          },
        );
      let executionHash: string;
      if (operation.kind === "approve-definition") {
        const definition = parsed.document?.definitions.find(
          (candidate) =>
            candidate.id === operation.definitionId &&
            candidate.version === operation.definitionVersion,
        );
        if (!definition)
          fail("Native effect definition version not found in this source.", {
            errorCode: "native_effect_definition_not_found",
            statusCode: 404,
          });
        executionHash = await hashEffectDefinition(definition);
        if (executionHash !== operation.expectedExecutionHash)
          fail("Native effect source changed since approval was requested.", {
            errorCode: "native_effect_execution_hash_mismatch",
            statusCode: 409,
          });
      } else {
        executionHash = operation.executionHash;
      }
      const approvalKey = nativeEffectApprovalKey(designId);
      const prior = await readAppState(approvalKey);
      let approvals;
      try {
        approvals = parseNativeEffectApprovalState(prior);
      } catch (error) {
        if (!(error instanceof NativeEffectApprovalStateError)) throw error;
        fail("Native effect approval state is unreadable.", {
          errorCode: "native_effect_approvals_unreadable",
          statusCode: 422,
        });
      }
      const hashes =
        operation.kind === "approve-definition"
          ? [...new Set([...approvals.hashes, executionHash])]
          : approvals.hashes.filter((hash) => hash !== executionHash);
      if (hashes.length > MAX_APPROVED_NATIVE_DEFINITION_HASHES)
        fail("Too many native effect approvals for this Design.", {
          errorCode: "native_effect_approvals_full",
          statusCode: 422,
        });
      const changed = hashes.length !== approvals.hashes.length;
      if (
        changed &&
        !(await compareAndSetAppState(approvalKey, prior, {
          schemaVersion: 1,
          hashes,
        }))
      )
        fail("Native effect approvals changed. Re-read and retry.", {
          errorCode: "native_effect_approvals_stale",
          statusCode: 409,
        });
      return {
        designId,
        fileId,
        path: file.filename,
        content: live.content,
        changed: false,
        versionHash: live.versionHash,
        updatedAt: file.updatedAt,
        instanceIds: parsed.document?.instances.map((item) => item.id) ?? [],
        nodeIds: [
          ...new Set(
            parsed.document?.instances.map((item) => item.nodeId) ?? [],
          ),
        ],
        diff: previewSourceDiff(live.content, live.content),
        approvedDefinitionHashes: hashes,
        approvalChanged: changed,
        validation: {
          cpuSchemaAndGraph: "passed" as const,
          gpuCompiled: false,
        },
      };
    }
    const next = editNativeEffectHtml(
      live.content,
      operation as NativeEffectEdit,
    );
    if (next.errors.length) {
      fail(`Native effect edit rejected: ${next.errors.join("; ")}`, {
        errorCode: "native_effect_validation_failed",
        statusCode: 422,
        details: { errors: next.errors },
      });
    }
    if (next.html !== live.content)
      await snapshotDesignBeforeAgentEdit(designId, context);
    let write: {
      changed: boolean;
      versionHash: string;
      updatedAt: string | null;
    };
    try {
      write =
        next.html === live.content
          ? {
              changed: false,
              versionHash: live.versionHash,
              updatedAt: file.updatedAt,
            }
          : await writeInlineSourceFile({
              designId,
              file: selectedWithContent,
              content: next.html,
              expectedVersionHash,
            });
    } catch (error) {
      if (error instanceof SourceWorkspaceEditConflictError)
        fail(
          "Source file changed while applying the native effect. Re-read and retry.",
          {
            errorCode: "native_effect_stale_source",
            statusCode: 409,
          },
        );
      throw error;
    }
    return {
      designId,
      fileId,
      path: file.filename,
      content: next.html,
      changed: write.changed,
      versionHash: write.versionHash,
      updatedAt: write.updatedAt,
      instanceIds: next.instanceIds,
      nodeIds: next.nodeIds,
      diff: previewSourceDiff(live.content, next.html),
      validation: { cpuSchemaAndGraph: "passed" as const, gpuCompiled: false },
    };
  },
});
