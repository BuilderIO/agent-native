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
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "../shared/native-effect-presets.js";
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
import { planNativeInputResources } from "../shared/native-input-resources.js";
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
const animation = z
  .object({
    duration: z.number().finite().gt(0).max(60),
    loop: z.boolean(),
    tracks: z
      .record(
        z.string().min(1),
        z
          .object({
            keys: z
              .array(
                z
                  .object({
                    time: z.number().finite().min(0),
                    value: z
                      .unknown()
                      .describe(
                        "Value matching the declared native property type",
                      ),
                    easing: z
                      .enum([
                        "linear",
                        "ease-in",
                        "ease-out",
                        "ease-in-out",
                        "step",
                      ])
                      .optional(),
                  })
                  .strict(),
              )
              .min(2)
              .max(32),
          })
          .strict(),
      )
      .refine(
        (tracks) =>
          Object.keys(tracks).length > 0 && Object.keys(tracks).length <= 16,
      ),
  })
  .strict()
  .describe(
    "Bounded native property tracks; key times start at zero, increase, and end at duration. The shared effect validator checks property types and eligibility.",
  );
const bindingTargets = z.record(
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
);
const operation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("apply"),
    nodeId: z.string().min(1).optional(),
    targetSelector: z.string().min(1).optional(),
    placement: z.enum(["fill", "layer", "backdrop"]),
    definitionId: z.string().optional(),
    definitionVersion: z.number().int().positive().optional(),
    definition: definition.optional(),
    params: values.optional(),
    clip: z.enum(["bounds", "text"]).optional(),
    bindings: z.unknown().optional(),
    bindingTargets: bindingTargets.optional(),
    transform: z.unknown().optional(),
    sourceSizing: sourceSizing.optional(),
    timing: presetTiming.optional(),
    animation: animation.optional(),
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
    bindingTargets: bindingTargets.optional(),
    transform: z.unknown().optional(),
    sourceSizing: sourceSizing.optional(),
    sourceSizingByNodeId: z.record(z.string().min(1), sourceSizing).optional(),
    timing: presetTiming.optional(),
    animation: animation.optional(),
  }),
  z.object({
    kind: z.literal("apply-preset"),
    nodeId: z.string().min(1).optional(),
    targetSelector: z.string().min(1).optional(),
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
    animation: animation.nullable().optional(),
    enabled: z.boolean().optional(),
    opacity: z.number().optional(),
    seed: z.number().int().min(0).max(1_000_000).optional(),
    clip: z.enum(["bounds", "text"]).optional(),
    placement: z.enum(["fill", "layer", "backdrop"]).optional(),
    bindings: z.unknown().nullable().optional(),
    bindingTargets: bindingTargets.optional(),
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
    "Apply or edit one exact registered native GPU effect in an inline Design HTML file using the current expectedVersionHash from read-source-file or get-shader. " +
    "Tier 1 executes only the 16 curated exact definition versions. Existing source-embedded custom definitions remain readable but cannot be newly applied or revised. " +
    "Apply, apply-preset, set-instance, playback, reset, duplicate, reorder, and remove persist through the canonical source writer. " +
    "CPU schema and graph validation does not compile GPU code; verify the Design preview and read back the committed source.",
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
    if (operation.kind === "approve-definition")
      fail("Custom native definitions are outside this release.", {
        errorCode: "definition-outside-tier-1",
        statusCode: 422,
      });
    if (operation.kind === "revoke-definition") {
      const parsed = parseEffectsFromHtml(live.content);
      if (parsed.errors.length)
        fail(
          `Native effect manifest is unreadable: ${parsed.errors.join("; ")}`,
          {
            errorCode: "native_effect_manifest_unreadable",
            statusCode: 422,
          },
        );
      const executionHash = operation.executionHash;
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
      const hashes = approvals.hashes.filter((hash) => hash !== executionHash);
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
    const resolveTargetSelector = (selector: string): string => {
      const { projection, resolution } = resolveCodeLayerTarget(
        preparedHtml,
        { selector: selector },
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
      return nodeId;
    };
    let preparedOperation = operation as NativeEffectEdit;
    if (operation.kind === "apply" || operation.kind === "apply-preset") {
      const nodeId = operation.targetSelector
        ? resolveTargetSelector(operation.targetSelector)
        : operation.nodeId;
      if (!nodeId)
        fail(
          "A stable authored node ID or a unique target selector is required.",
          {
            errorCode: "native_effect_target_not_found",
            statusCode: 422,
          },
        );
      preparedOperation = {
        ...operation,
        nodeId,
        targetSelector: undefined,
      } as NativeEffectEdit;
    }

    if (
      (operation.kind === "set-instance" ||
        operation.kind === "apply" ||
        operation.kind === "apply-many") &&
      operation.bindingTargets
    ) {
      const parsed = parseEffectsFromHtml(live.content);
      if (parsed.errors.length)
        fail("Native effect manifest is unreadable.", {
          errorCode: "native_effect_manifest_unreadable",
          statusCode: 422,
        });
      const instance =
        operation.kind === "set-instance"
          ? parsed.document?.instances.find(
              (item) => item.id === operation.instanceId,
            )
          : null;
      if (operation.kind === "set-instance" && !instance)
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
        ...(supplied === null ? {} : (supplied ?? instance?.bindings ?? {})),
      } as Record<
        string,
        import("../shared/native-effects.js").EffectInputBinding
      >;
      for (const [name, target] of Object.entries(operation.bindingTargets)) {
        const nodeId = resolveTargetSelector(target.selector);
        bindings[name] = {
          kind: "authored-node",
          nodeId,
          capture: target.capture,
        };
      }
      preparedOperation = {
        ...preparedOperation,
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
    const beforeManifest = parseEffectsFromHtml(live.content);
    const afterManifest = parseEffectsFromHtml(next.html);
    if (afterManifest.errors.length)
      fail("Native effect result could not be read back.", {
        errorCode: "native_effect_manifest_unreadable",
        statusCode: 422,
      });
    const priorDefinitions = new Map(
      (beforeManifest.document?.definitions ?? []).map((item) => [
        `${item.id}\u0000${item.version}`,
        item,
      ]),
    );
    const nextDefinitions = new Map(
      (afterManifest.document?.definitions ?? []).map((item) => [
        `${item.id}\u0000${item.version}`,
        item,
      ]),
    );
    const isCurated = async (
      item: (typeof NATIVE_EFFECT_DEFINITION_CATALOG)[number],
    ) => {
      const builtin = NATIVE_EFFECT_DEFINITION_CATALOG.find(
        (candidate) =>
          candidate.id === item.id && candidate.version === item.version,
      );
      return (
        builtin !== undefined &&
        (await hashEffectDefinition(item)) ===
          (await hashEffectDefinition(builtin))
      );
    };
    for (const [key, item] of nextDefinitions) {
      const previous = priorDefinitions.get(key);
      if (previous && JSON.stringify(previous) === JSON.stringify(item))
        continue;
      if (!(await isCurated(item)))
        fail("This native definition is outside the Tier 1 catalog.", {
          errorCode: "definition-outside-tier-1",
          statusCode: 422,
        });
    }
    const previousInstances = new Map(
      (beforeManifest.document?.instances ?? []).map((item) => [item.id, item]),
    );
    for (const item of afterManifest.document?.instances ?? []) {
      if (!item.enabled) continue;
      const previous = previousInstances.get(item.id);
      const key = `${item.definitionId}\u0000${item.definitionVersion}`;
      const previousDefinition = priorDefinitions.get(key);
      const currentDefinition = nextDefinitions.get(key);
      if (
        previous &&
        JSON.stringify(previous) === JSON.stringify(item) &&
        previousDefinition &&
        currentDefinition &&
        JSON.stringify(previousDefinition) === JSON.stringify(currentDefinition)
      )
        continue;
      if (!currentDefinition || !(await isCurated(currentDefinition)))
        fail("This native definition is outside the Tier 1 catalog.", {
          errorCode: "definition-outside-tier-1",
          statusCode: 422,
        });
    }
    const enabledLayersByNode = (
      instances: readonly import("../shared/native-effects.js").EffectInstance[],
    ) => {
      const counts = new Map<string, number>();
      for (const instance of instances) {
        if (instance.placement !== "layer" || !instance.enabled) continue;
        counts.set(instance.nodeId, (counts.get(instance.nodeId) ?? 0) + 1);
      }
      return counts;
    };
    const beforeLayerCounts = enabledLayersByNode(
      beforeManifest.document?.instances ?? [],
    );
    for (const [nodeId, count] of enabledLayersByNode(
      afterManifest.document?.instances ?? [],
    )) {
      if (count > 1 && count > (beforeLayerCounts.get(nodeId) ?? 0))
        fail(
          "Only one native Layer effect can be enabled on an authored node in this release.",
          {
            errorCode: "native_effect_layer_limit",
            statusCode: 422,
          },
        );
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
      for (const item of changedInstances) {
        const definition = after.document.definitions.find(
          (candidate) =>
            candidate.id === item.definitionId &&
            candidate.version === item.definitionVersion,
        );
        if (!definition) continue;
        const plan = planNativeInputResources(definition, item);
        if (!plan.ok)
          fail(plan.detail, {
            errorCode: plan.code,
            statusCode: 422,
          });
        if (!authoredSourceBindingsAvailable(next.html, plan.inputs))
          fail(
            "An authored input layer is missing or duplicated in this file.",
            {
              errorCode: "native_effect_source_layer_unavailable",
              statusCode: 422,
            },
          );
      }
    }
    if (next.html !== live.content)
      await snapshotDesignBeforeAgentEdit(designId, context);
    let write: {
      content: string;
      changed: boolean;
      versionHash: string;
      updatedAt: string | null;
    };
    try {
      write =
        next.html === live.content
          ? {
              content: live.content,
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
    const committed = parseEffectsFromHtml(write.content);
    if (
      committed.errors.length ||
      (next.instanceIds.length > 0 && !committed.document)
    )
      fail("Committed native effect manifest could not be read back.", {
        errorCode: "native_effect_manifest_unreadable",
        statusCode: 422,
      });
    return {
      designId,
      fileId,
      path: file.filename,
      content: write.content,
      changed: write.changed,
      versionHash: write.versionHash,
      updatedAt: write.updatedAt,
      instanceIds: committed.document?.instances.map((item) => item.id) ?? [],
      nodeIds: [
        ...new Set(
          committed.document?.instances.map((item) => item.nodeId) ?? [],
        ),
      ],
      diff: previewSourceDiff(live.content, write.content),
      validation: { cpuSchemaAndGraph: "passed" as const, gpuCompiled: false },
    };
  },
});
