import type { EffectPreviewPolicy } from "./native-effects";

export const DESIGN_EDITOR_PREFERENCES_SETTING_KEY =
  "design-editor-preferences";

export interface DesignEditorPreferences {
  nativeShaderPreview?: EffectPreviewPolicy | null;
}

export function isUserSettingsContainer(
  value: unknown,
): value is Record<string, unknown> | null {
  return value === null || (typeof value === "object" && !Array.isArray(value));
}

export function isEffectPreviewPolicy(
  value: unknown,
): value is EffectPreviewPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;

  const policy = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "quality",
    "frameRateTarget",
    "colorMode",
    "dynamicRange",
  ]);
  if (Object.keys(policy).some((key) => !allowedKeys.has(key))) return false;
  return (
    (policy.quality === "auto" ||
      policy.quality === "performance" ||
      policy.quality === "quality") &&
    (policy.frameRateTarget === 60 || policy.frameRateTarget === 120) &&
    (policy.colorMode === undefined ||
      policy.colorMode === "srgb" ||
      policy.colorMode === "display-p3") &&
    (policy.dynamicRange === undefined ||
      policy.dynamicRange === "sdr" ||
      policy.dynamicRange === "hdr")
  );
}

export function parseNativeShaderPreviewPreference(
  value: unknown,
):
  | { status: "absent"; policy: null }
  | { status: "ok"; policy: EffectPreviewPolicy }
  | { status: "invalid" } {
  if (value === undefined || value === null)
    return { status: "absent", policy: null };
  if (!isEffectPreviewPolicy(value)) return { status: "invalid" };
  return { status: "ok", policy: { ...value } };
}
