import { randomUUID } from "node:crypto";

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
import { resolveCodeLayerTarget } from "../shared/code-layer.js";
import { authoredSourceBindingsAvailable } from "../shared/native-authored-source-bindings.js";
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
    params: values.optional(),
    enabled: z.boolean().optional(),
    opacity: z.number().optional(),
    seed: z.number().int().min(0).max(1_000_000).optional(),
    clip: z.enum(["bounds", "text"]).optional(),
    placement: z.enum(["fill", "layer", "backdrop"]).optional(),
    bindings: z.unknown().nullable().optional(),
    bindingTargets: z
      .record(
        z.string(),
        z.object({
          selector: z
            .string()
            .min(1)
            .describe(
              "Unique same-file source selector; the action persists an authored node ID before binding.",
            ),
          capture: z.enum(["content", "appearance"]),
        }),
      )
      .optional(),
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
    "set-instance can update params and bindings atomically; bindingTargets resolves unique same-file selectors and stamps stable authored node IDs on unlocked sources in that write. Authored bindings are for ordinary render-pass inputs, not compute or stateful effects. " +
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
    let preparedHtml = live.content;
    let preparedOperation = operation as NativeEffectEdit;
    if (operation.kind === "set-instance" && operation.bindingTargets) {
      const parsed = parseEffectsFromHtml(live.content);
      if (parsed.errors.length)
        fail("Native effect manifest is unreadable.", {
          errorCode: "native_effect_manifest_unreadable",
          statusCode: 422,
        });
      const instance = parsed.document?.instances.find(
        (item) => item.id === operation.instanceId,
      );
      if (!instance)
        fail("Native effect instance not found.", {
          errorCode: "native_effect_instance_not_found",
          statusCode: 404,
        });
      const supplied = operation.bindings;
      if (
        supplied !== undefined &&
        supplied !== null &&
        (typeof supplied !== "object" || Array.isArray(supplied))
      )
        fail("Input bindings must be a named record.", {
          errorCode: "native_effect_validation_failed",
          statusCode: 422,
        });
      const bindings = {
        ...(supplied === null ? {} : (supplied ?? instance.bindings ?? {})),
      } as Record<
        string,
        import("../shared/native-effects.js").EffectInputBinding
      >;
      for (const [name, target] of Object.entries(operation.bindingTargets)) {
        const { projection, resolution } = resolveCodeLayerTarget(
          preparedHtml,
          { selector: target.selector },
          {
            source: {
              kind: "design-file",
              designId,
              fileId,
              filename: file.filename,
            },
          },
        );
        const node = resolution.status === "resolved" ? resolution.node : null;
        const span = node?.source;
        if (!node || !span)
          fail("Canvas layer changed or could not be uniquely resolved.", {
            errorCode: "native_effect_source_layer_unavailable",
            statusCode: 409,
          });
        const rawId = node.dataAttributes["data-agent-native-node-id"]?.trim();
        const sameIdCount = rawId
          ? projection.nodes.filter(
              (candidate) =>
                candidate.dataAttributes["data-agent-native-node-id"] === rawId,
            ).length
          : 0;
        let nodeId = rawId;
        const openTag = preparedHtml.slice(span.openStart, span.openEnd);
        const stableIdAttributes = [
          ...openTag.matchAll(
            /\sdata-agent-native-node-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/gi,
          ),
        ];
        if (
          !nodeId ||
          !/^[A-Za-z0-9_.:-]{1,128}$/.test(nodeId) ||
          sameIdCount !== 1 ||
          stableIdAttributes.length !== 1
        ) {
          const byId = new Map(
            projection.nodes.map((candidate) => [candidate.id, candidate]),
          );
          let ancestor: typeof node | undefined = node;
          while (ancestor) {
            if (ancestor.dataAttributes["data-agent-native-locked"] === "true")
              fail("A locked canvas layer cannot receive a source ID.", {
                errorCode: "native_effect_source_layer_locked",
                statusCode: 422,
              });
            ancestor = ancestor.parentId
              ? byId.get(ancestor.parentId)
              : undefined;
          }
          nodeId = `an.${randomUUID().replace(/-/g, "")}`;
          const cleaned = openTag.replace(
            /\sdata-agent-native-node-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/gi,
            "",
          );
          const insertAt = cleaned.endsWith("/>")
            ? cleaned.length - 2
            : cleaned.length - 1;
          const annotated = `${cleaned.slice(0, insertAt)} data-agent-native-node-id="${nodeId}"${cleaned.slice(insertAt)}`;
          preparedHtml =
            preparedHtml.slice(0, span.openStart) +
            annotated +
            preparedHtml.slice(span.openEnd);
        }
        bindings[name] = {
          kind: "authored-node",
          nodeId,
          capture: target.capture,
        };
      }
      preparedOperation = {
        ...operation,
        bindings,
        bindingTargets: undefined,
      } as NativeEffectEdit;
    }
    const next = editNativeEffectHtml(preparedHtml, preparedOperation);
    if (next.errors.length) {
      fail(`Native effect edit rejected: ${next.errors.join("; ")}`, {
        errorCode: "native_effect_validation_failed",
        statusCode: 422,
        details: { errors: next.errors },
      });
    }
    if (
      operation.kind === "apply" ||
      operation.kind === "apply-many" ||
      operation.kind === "apply-preset" ||
      (operation.kind === "set-instance" &&
        (operation.bindings !== undefined || operation.bindingTargets))
    ) {
      const beforeIds = new Set(
        parseEffectsFromHtml(live.content).document?.instances.map(
          (item) => item.id,
        ) ?? [],
      );
      const after = parseEffectsFromHtml(next.html);
      if (after.errors.length || !after.document)
        fail("Native effect result could not be read back.", {
          errorCode: "native_effect_manifest_unreadable",
          statusCode: 422,
        });
      const changedInstances = after.document.instances.filter((item) =>
        operation.kind === "set-instance"
          ? item.id === operation.instanceId
          : !beforeIds.has(item.id),
      );
      if (
        changedInstances.some(
          (item) => !authoredSourceBindingsAvailable(next.html, item.bindings),
        )
      )
        fail("An authored input layer is missing or duplicated in this file.", {
          errorCode: "native_effect_source_layer_unavailable",
          statusCode: 422,
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
