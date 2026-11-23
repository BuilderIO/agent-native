import type { DataResourceAiUsage } from "../../app/lib/model/data-resource-contracts.js";
import { readWorkspaceWarehouseDescription } from "../../shared/workspace-warehouse-description.js";

/**
 * One effective connection presentation shared by the connection DTO, the edit
 * form, the save result and every AI gate. Canonical annotation fields win once
 * they are explicitly initialized; until then the legacy connection config is
 * the supported fallback, and a missing legacy AI boolean is excluded rather
 * than silently included.
 */
export type ConnectionAnnotationOverride = {
  description: string;
  aiUsage: DataResourceAiUsage | null;
  descriptionInitialized?: boolean | undefined;
  aiUsageInitialized?: boolean | undefined;
  revision?: number | undefined;
};

export type ConnectionPresentation = {
  description: string;
  effectiveAiUsage: DataResourceAiUsage;
  descriptionInitialized: boolean;
  aiUsageInitialized: boolean;
  annotationRevision: number;
};

export type LegacyConnectionPolicy = {
  description?: unknown;
  includeForAI?: unknown;
  workspaceCredentialProfile?: unknown;
  descriptionJson?: unknown;
};

/** Why a value won, so a caller can explain the canonical/legacy boundary. */
export type ConnectionPresentationSource = {
  description: "canonical" | "native" | "legacy" | "default";
  aiUsage: "canonical" | "legacy" | "default";
};

function nativeDescription(config: LegacyConnectionPolicy): string | undefined {
  if (
    config.workspaceCredentialProfile !== "workspace-v1" ||
    config.descriptionJson === undefined
  )
    return undefined;
  return readWorkspaceWarehouseDescription(config.descriptionJson);
}

export function resolveConnectionPresentation(
  legacy: LegacyConnectionPolicy,
  override: ConnectionAnnotationOverride | null,
): ConnectionPresentation {
  const legacyDescription =
    nativeDescription(legacy) ??
    (typeof legacy.description === "string" ? legacy.description : "");
  const descriptionInitialized = override?.descriptionInitialized === true;
  const aiUsageInitialized = override?.aiUsageInitialized === true;
  const legacyIncluded =
    typeof legacy.includeForAI === "boolean" ? legacy.includeForAI : undefined;
  return {
    description: descriptionInitialized
      ? (override?.description ?? "")
      : legacyDescription,
    effectiveAiUsage: aiUsageInitialized
      ? ((override?.aiUsage ?? "excluded") as DataResourceAiUsage)
      : legacyIncluded === true
        ? "included"
        : "excluded",
    descriptionInitialized,
    aiUsageInitialized,
    annotationRevision: override?.revision ?? 0,
  };
}

export function presentationSource(
  legacy: LegacyConnectionPolicy,
  presentation: ConnectionPresentation,
): ConnectionPresentationSource {
  return {
    description: presentation.descriptionInitialized
      ? "canonical"
      : nativeDescription(legacy) !== undefined
        ? "native"
        : typeof legacy.description === "string"
          ? "legacy"
          : "default",
    aiUsage: presentation.aiUsageInitialized
      ? "canonical"
      : typeof legacy.includeForAI === "boolean"
        ? "legacy"
        : "default",
  };
}

export function isAgentIncluded(presentation: ConnectionPresentation): boolean {
  return presentation.effectiveAiUsage === "included";
}

/**
 * Child resources inherit the connection's effective AI usage unless they carry
 * their own override. An excluded ancestor always wins, so a descendant cannot
 * be re-enabled while its connection is opted out.
 */
export function resolveResourceAiUsage(
  ancestor: DataResourceAiUsage,
  override: DataResourceAiUsage | null | undefined,
): DataResourceAiUsage {
  if (ancestor === "excluded") return "excluded";
  return override ?? ancestor;
}
