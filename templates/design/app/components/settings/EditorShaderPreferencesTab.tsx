import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { EffectPreviewPolicy } from "@shared/native-effects";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const DEFAULT_EDITOR_PREVIEW_POLICY: EffectPreviewPolicy = {
  quality: "auto",
  frameRateTarget: 60,
  colorMode: "srgb",
  dynamicRange: "sdr",
};

export function EditorShaderPreferencesTab({
  liveDiagnostics,
}: {
  liveDiagnostics?: ReactNode;
} = {}) {
  const t = useT();
  const preferences = useActionQuery("get-editor-preferences", {});
  const update = useActionMutation("update-editor-preferences");
  const [optimisticPolicy, setOptimisticPolicy] = useState<
    EffectPreviewPolicy | null | undefined
  >(undefined);
  const savedPolicy = preferences.data?.nativeShaderPreview ?? null;
  const policy =
    optimisticPolicy === undefined ? savedPolicy : optimisticPolicy;
  const pending = preferences.isLoading || update.isPending;

  useEffect(() => {
    if (
      optimisticPolicy !== undefined &&
      preferences.data !== undefined &&
      samePreviewPolicy(savedPolicy, optimisticPolicy)
    )
      setOptimisticPolicy(undefined);
  }, [optimisticPolicy, preferences.data, savedPolicy]);

  const save = useCallback(
    async (next: EffectPreviewPolicy | null) => {
      const previous = policy;
      setOptimisticPolicy(next);
      try {
        await update.mutateAsync({ nativeShaderPreview: next });
      } catch (error) {
        setOptimisticPolicy(previous);
        toast.error(
          actionErrorMessage(error) ??
            t("settings.editorPreferencesSaveFailed"),
        );
      }
    },
    [policy, t, update],
  );

  const change = <K extends keyof EffectPreviewPolicy>(
    key: K,
    value: EffectPreviewPolicy[K],
  ) => {
    const current = policy ?? DEFAULT_EDITOR_PREVIEW_POLICY;
    void save({ ...current, [key]: value });
  };

  return (
    <div className="grid max-w-xl gap-4">
      <label className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">
          {t("settings.editorShaderPreview")}
        </span>
        <Switch
          checked={policy !== null}
          disabled={pending || preferences.isError}
          onCheckedChange={(enabled) =>
            void save(enabled ? DEFAULT_EDITOR_PREVIEW_POLICY : null)
          }
        />
      </label>
      {preferences.isError && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-destructive">
            {t("settings.editorPreferencesUnavailable")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void preferences.refetch()}
          >
            {t("settings.editorPreferencesRetry")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void save(null)}
          >
            {t("settings.editorPreferencesUseDocument")}
          </Button>
        </div>
      )}
      {policy && (
        <div className="grid gap-3 border-t pt-3">
          <PreferenceSelect
            label={t("editPanel.shaders.nativePreviewPolicy")}
            value={policy.quality}
            disabled={pending || preferences.isError}
            onValueChange={(value) =>
              value === "auto" || value === "performance" || value === "quality"
                ? change("quality", value)
                : undefined
            }
            options={[
              ["auto", t("editPanel.shaders.nativePreviewAuto")],
              ["performance", t("editPanel.shaders.nativePreviewPerformance")],
              ["quality", t("editPanel.shaders.nativePreviewQuality")],
            ]}
          />
          <PreferenceSelect
            label={t("editPanel.shaders.nativePreviewTarget")}
            value={String(policy.frameRateTarget)}
            disabled={pending || preferences.isError}
            onValueChange={(value) =>
              value === "60" || value === "120"
                ? change("frameRateTarget", Number(value) as 60 | 120)
                : undefined
            }
            options={[
              ["60", "60"],
              ["120", "120"],
            ]}
          />
          <PreferenceSelect
            label={t("editPanel.shaders.nativeOutputColor")}
            value={policy.colorMode ?? "srgb"}
            disabled={pending || preferences.isError}
            onValueChange={(value) =>
              value === "srgb" || value === "display-p3"
                ? change("colorMode", value)
                : undefined
            }
            options={[
              ["srgb", "sRGB"],
              ["display-p3", t("editPanel.shaders.nativeColorP3")],
            ]}
          />
          <PreferenceSelect
            label={t("editPanel.shaders.nativeDynamicRange")}
            value={policy.dynamicRange ?? "sdr"}
            disabled={pending || preferences.isError}
            onValueChange={(value) =>
              value === "sdr" || value === "hdr"
                ? change("dynamicRange", value)
                : undefined
            }
            options={[
              ["sdr", t("editPanel.shaders.nativeDynamicRangeSdr")],
              ["hdr", t("editPanel.shaders.nativeDynamicRangeHdr")],
            ]}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={pending || preferences.isError}
            onClick={() => void save(null)}
          >
            {t("settings.editorPreferencesUseDocument")}
          </Button>
        </div>
      )}
      <details className="border-t pt-3 text-sm">
        <summary className="cursor-pointer font-medium">
          {t("settings.editorPreviewDiagnostics")}
        </summary>
        {liveDiagnostics ?? (
          <p className="pt-2 text-muted-foreground">
            {t("settings.editorPreviewDiagnosticsUnavailable")}
          </p>
        )}
      </details>
    </div>
  );
}

function samePreviewPolicy(
  left: EffectPreviewPolicy | null,
  right: EffectPreviewPolicy | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.quality === right.quality &&
    left.frameRateTarget === right.frameRateTarget &&
    left.colorMode === right.colorMode &&
    left.dynamicRange === right.dynamicRange
  );
}

function PreferenceSelect({
  label,
  value,
  disabled,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <Select value={value} disabled={disabled} onValueChange={onValueChange}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
