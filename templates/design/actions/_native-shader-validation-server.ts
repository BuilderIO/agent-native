import { fail } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";

import {
  loadSelectedSourceWorkspaceFile,
  readLiveSourceFile,
  resolveSourceWorkspace,
} from "../server/source-workspace.js";
import { NATIVE_EFFECT_PRESETS } from "../shared/native-effect-presets.js";
import {
  hashEffectDefinition,
  nativeEffectApprovalKey,
  parseNativeEffectApprovalState,
} from "../shared/native-effect-trust.js";
import {
  authoredNodeCount,
  parseEffectsFromHtml,
  validateEffectDocument,
  type EffectDefinition,
  type EffectDocument,
  type EffectInstance,
} from "../shared/native-effects.js";
import {
  nativeShaderValidationStateKey,
  nativeShaderValidationStateSchema,
  type NativeShaderValidationRequest,
  type NativeShaderValidationState,
} from "../shared/native-shader-validation.js";
import { classifyNativeLocalExportNavigation } from "./_native-local-export-server.js";

export async function readNativeShaderValidationSource(
  designId: string,
  fileId: string,
): Promise<{ content: string; versionHash: string }> {
  const workspace = await resolveSourceWorkspace(designId, {
    includeContent: false,
    includeBoard: true,
  });
  if (workspace.sourceType !== "inline")
    fail("Native shader validation requires inline Design source.", {
      errorCode: "native_validation_source_unsupported",
      statusCode: 422,
    });
  const file = workspace.files.find((candidate) => candidate.id === fileId);
  if (!file || file.fileType !== "html")
    fail("Selected Design HTML file was not found.", {
      errorCode: "native_validation_file_not_found",
      statusCode: 404,
    });
  const stored = await loadSelectedSourceWorkspaceFile(file);
  if (!stored)
    fail("Selected Design source is unavailable.", {
      errorCode: "native_validation_source_unreadable",
      statusCode: 422,
    });
  const live = await readLiveSourceFile(stored);
  return { content: live.content, versionHash: live.versionHash };
}

export async function verifyNativeShaderValidationCases(
  source: string,
  request: NativeShaderValidationRequest,
): Promise<EffectDocument> {
  const parsed = parseEffectsFromHtml(source);
  if (parsed.errors.length || !parsed.document)
    fail("Native effect manifest is absent or unreadable.", {
      errorCode: "native_validation_manifest_unreadable",
      statusCode: 422,
    });
  const document = parsed.document;
  if (
    request.cases.some((item) => item.fixture) &&
    request.expectedVersionHash.length > 128
  )
    fail("Native source version is too long for a clean fixture.", {
      errorCode: "native_validation_fixture_invalid",
      statusCode: 422,
    });
  for (const item of request.cases) {
    const instance = document.instances.find(
      (candidate) => candidate.id === item.instanceId,
    );
    if (
      !instance ||
      !instance.enabled ||
      instance.nodeId !== item.nodeId ||
      instance.definitionId !== item.definitionId ||
      instance.definitionVersion !== item.definitionVersion ||
      authoredNodeCount(source, item.nodeId) !== 1
    )
      fail(
        `Native validation case ${item.caseId} has no unique mounted target.`,
        {
          errorCode: "native_validation_target_unavailable",
          statusCode: 422,
        },
      );
    const definition = document.definitions.find(
      (candidate) =>
        candidate.id === item.definitionId &&
        candidate.version === item.definitionVersion,
    );
    if (
      !definition ||
      (await hashEffectDefinition(definition)) !== item.executionHash
    )
      fail(
        `Native validation case ${item.caseId} has a different executable source.`,
        {
          errorCode: "native_validation_source_stale",
          statusCode: 409,
        },
      );
    if (
      (definition.simulation || definition.feedback) &&
      !item.fixture &&
      !item.mountedFrame
    )
      fail(
        `Stateful native validation case ${item.caseId} requires a bounded held frame.`,
        {
          errorCode: "native_validation_frame_required",
          statusCode: 422,
        },
      );
  }
  return document;
}

export async function prepareNativeShaderValidationFixtures(
  source: string,
  request: NativeShaderValidationRequest,
): Promise<{
  approvedExecutionHashes: string[];
  items: Array<{
    id: string;
    definition: EffectDefinition;
    placement: EffectInstance["placement"];
    params: EffectInstance["params"];
    seed: number;
    sourceRevision: string;
    timeSeconds: number;
    fixture: NonNullable<
      NativeShaderValidationRequest["cases"][number]["fixture"]
    >;
  }>;
}> {
  const document = await verifyNativeShaderValidationCases(source, request);
  const items: Array<{
    id: string;
    definition: EffectDefinition;
    placement: EffectInstance["placement"];
    params: EffectInstance["params"];
    seed: number;
    sourceRevision: string;
    timeSeconds: number;
    fixture: NonNullable<
      NativeShaderValidationRequest["cases"][number]["fixture"]
    >;
  }> = [];
  for (const validationCase of request.cases) {
    const fixture = validationCase.fixture;
    if (!fixture) continue;
    const definition = document.definitions.find(
      (candidate) =>
        candidate.id === validationCase.definitionId &&
        candidate.version === validationCase.definitionVersion,
    );
    const instance = document.instances.find(
      (candidate) => candidate.id === validationCase.instanceId,
    );
    if (!definition || !instance)
      fail("Native validation source changed before fixture preparation.", {
        errorCode: "native_validation_source_stale",
        statusCode: 409,
      });
    const supportedSource =
      instance.placement === "fill"
        ? fixture.sourceKind !== "owned-image"
        : fixture.sourceKind !== "generated";
    if (!supportedSource || instance.bindings || instance.transform)
      fail("This native effect cannot use the selected clean fixture.", {
        errorCode: "native_validation_fixture_unsupported",
        statusCode: 422,
      });
    const preset = fixture.presetId
      ? [...(document.presets ?? []), ...NATIVE_EFFECT_PRESETS].find(
          (candidate) => candidate.id === fixture.presetId,
        )
      : undefined;
    if (
      (fixture.presetId && !preset) ||
      (preset &&
        (preset.definitionId !== definition.id ||
          preset.definitionVersion !== definition.version ||
          preset.placement !== instance.placement ||
          preset.bindings ||
          preset.transform))
    )
      fail("The selected preset does not match this mounted effect.", {
        errorCode: "native_validation_preset_mismatch",
        statusCode: 422,
      });
    const params = {
      ...instance.params,
      ...(preset?.params ?? {}),
      ...(fixture.params ?? {}),
    };
    const checked = validateEffectDocument({
      schemaVersion: 2,
      definitions: [definition],
      instances: [{ ...instance, params, seed: fixture.seed }],
    });
    if (!checked.valid)
      fail("Native validation fixture has invalid properties.", {
        errorCode: "native_validation_fixture_invalid",
        statusCode: 422,
      });
    items.push({
      id: validationCase.caseId,
      definition,
      placement: instance.placement,
      params: checked.document!.instances[0].params,
      seed: fixture.seed,
      sourceRevision: request.expectedVersionHash,
      fixture,
      timeSeconds: validationCase.timeSeconds,
      ...(validationCase.expectedLinearSamples
        ? { expectedLinearSamples: validationCase.expectedLinearSamples }
        : {}),
    });
  }
  const approvals = parseNativeEffectApprovalState(
    await readAppState(nativeEffectApprovalKey(request.designId)),
  );
  return { approvedExecutionHashes: approvals.hashes, items };
}

export async function readNativeShaderValidationState(
  designId: string,
  tabId: string,
): Promise<NativeShaderValidationState | null> {
  const raw = await readAppState(
    nativeShaderValidationStateKey(designId, tabId),
  );
  if (raw === null) return null;
  const parsed = nativeShaderValidationStateSchema.safeParse(raw);
  if (!parsed.success)
    fail("Native shader validation state is unreadable.", {
      errorCode: "native_validation_state_unreadable",
      statusCode: 422,
    });
  return parsed.data;
}

export async function expireNativeShaderValidationState(
  current: NativeShaderValidationState,
): Promise<NativeShaderValidationState> {
  if (
    current.expiresAt > Date.now() ||
    ["validation-complete", "failed", "canceled", "expired"].includes(
      current.status,
    )
  )
    return current;
  const expired: NativeShaderValidationState = {
    ...current,
    status: "expired",
    failure: {
      code: "client-unavailable",
      message:
        "The editor did not finish GPU validation before its lease expired.",
    },
  };
  const key = nativeShaderValidationStateKey(current.designId, current.tabId);
  if (await compareAndSetAppState(key, current, expired)) return expired;
  const latest = await readNativeShaderValidationState(
    current.designId,
    current.tabId,
  );
  if (!latest)
    fail("Native shader validation disappeared during expiration.", {
      errorCode: "native_validation_state_conflict",
      statusCode: 409,
    });
  return latest;
}

export async function markNativeShaderValidationEditorLeft(
  current: NativeShaderValidationState,
): Promise<NativeShaderValidationState> {
  if (!["pending", "running", "cancel-requested"].includes(current.status))
    return current;
  const navigation = await readAppState(`navigation:${current.tabId}`);
  const state = classifyNativeLocalExportNavigation(
    navigation,
    current.designId,
  );
  if (state === "unreadable")
    fail("Native editor navigation is unreadable.", {
      errorCode: "native_validation_context_unreadable",
      statusCode: 422,
    });
  if (state === "matching") return current;
  const left: NativeShaderValidationState = {
    ...current,
    status: "expired",
    failure: {
      code: "editor-left",
      message: "The selected editor tab left this Design.",
    },
  };
  const key = nativeShaderValidationStateKey(current.designId, current.tabId);
  if (await compareAndSetAppState(key, current, left)) return left;
  const latest = await readNativeShaderValidationState(
    current.designId,
    current.tabId,
  );
  if (!latest)
    fail("Native shader validation disappeared after the editor left.", {
      errorCode: "native_validation_state_conflict",
      statusCode: 409,
    });
  return latest;
}
