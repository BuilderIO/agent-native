import { useT } from "@agent-native/core/client/i18n";
import { IconArrowsShuffle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

import type { SlideDesignTokens } from "../open-slide-runtime/protocol";
import { shuffleSlideDesignTokens } from "./design-token-presets";
import { getEditorActionErrorTranslationKey } from "./editor-action-errors";
import { OpenSlideFontBrowser } from "./OpenSlideFontBrowser";

const FONT_PRESETS = [
  "Arial",
  "Courier New",
  "Georgia",
  "Helvetica",
  "system-ui",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

type Props = {
  tokens: SlideDesignTokens | null;
  disabled: boolean;
  saving: boolean;
  onPreview: (tokens: SlideDesignTokens) => void;
  onSave: (tokens: SlideDesignTokens) => Promise<void>;
};

function cloneTokens(tokens: SlideDesignTokens): SlideDesignTokens {
  return { ...tokens };
}

export function OpenSlideDesignTokens({
  tokens,
  disabled,
  saving,
  onPreview,
  onSave,
}: Props) {
  const t = useT();
  const tokenSignature = tokens
    ? JSON.stringify([
        tokens.background,
        tokens.text,
        tokens.accent,
        tokens.displayFont,
        tokens.bodyFont,
        tokens.displayFontAssetId,
        tokens.bodyFontAssetId,
        tokens.heroScale,
        tokens.bodyScale,
        tokens.radius,
      ])
    : null;
  const previousTokenSignature = useRef(tokenSignature);
  const [draft, setDraft] = useState<SlideDesignTokens | null>(() =>
    tokens ? cloneTokens(tokens) : null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fontBrowserOpen, setFontBrowserOpen] = useState(false);
  const dirty = Boolean(
    tokens && draft && JSON.stringify(tokens) !== JSON.stringify(draft),
  );

  useEffect(() => {
    if (previousTokenSignature.current === tokenSignature) return;
    previousTokenSignature.current = tokenSignature;
    setDraft(tokens ? cloneTokens(tokens) : null);
    setSaveError(null);
  }, [tokens, tokenSignature]);

  const update = (patch: Partial<SlideDesignTokens>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaveError(null);
    onPreview(next);
  };

  const shuffle = () => {
    if (!draft) return;
    update(shuffleSlideDesignTokens(draft));
  };

  const save = async () => {
    if (!draft || !dirty || disabled || saving) return;
    setSaveError(null);
    try {
      await onSave(draft);
    } catch (error) {
      setSaveError(
        t(getEditorActionErrorTranslationKey(error) ?? "settings.saveFailed"),
      );
    }
  };

  if (!draft) {
    return (
      <aside className="flex h-full w-[288px] shrink-0 flex-col border-s border-border bg-background">
        <div className="border-b border-border px-4 py-3 text-sm font-medium">
          {t("openSlideDesignTokens.title")}
        </div>
        <p className="px-4 py-5 text-sm text-muted-foreground">
          {t("presentation.loadFailed")}
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[288px] shrink-0 flex-col border-s border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium">
          {t("openSlideDesignTokens.title")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t("openSlideDesignTokens.shuffle")}
          title={t("openSlideDesignTokens.shuffle")}
          disabled={disabled || saving}
          onClick={shuffle}
        >
          <IconArrowsShuffle className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4">
        <section className="grid gap-3 border-b border-border py-4">
          <h3 className="text-xs font-medium text-foreground">
            {t("openSlideDesignTokens.colors")}
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["background", t("openSlideDesignTokens.background")],
                ["text", t("openSlideDesignTokens.text")],
                ["accent", t("openSlideDesignTokens.accent")],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="grid min-w-0 gap-1 text-xs text-muted-foreground"
              >
                <span className="truncate">{label}</span>
                <Input
                  type="color"
                  value={draft[key]}
                  disabled={disabled || saving}
                  onChange={(event) =>
                    update({ [key]: event.currentTarget.value })
                  }
                  className="h-9 p-1"
                  aria-label={label}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="grid gap-3 border-b border-border py-4">
          <h3 className="text-xs font-medium text-foreground">
            {t("openSlideDesignTokens.typography")}
          </h3>
          {(
            [
              ["displayFont", t("openSlideDesignTokens.displayFont")],
              ["bodyFont", t("openSlideDesignTokens.bodyFont")],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="grid gap-1 text-xs text-muted-foreground"
            >
              <span>{label}</span>
              <Select
                value={draft[key]}
                disabled={disabled || saving}
                onValueChange={(value) => {
                  const assetKey =
                    key === "displayFont"
                      ? "displayFontAssetId"
                      : "bodyFontAssetId";
                  update({
                    [key]: value,
                    [assetKey]: FONT_PRESETS.includes(
                      value as (typeof FONT_PRESETS)[number],
                    )
                      ? undefined
                      : draft[assetKey],
                  });
                }}
              >
                <SelectTrigger
                  className="h-8 text-foreground"
                  aria-label={label}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...FONT_PRESETS, draft[key]])].map((font) => (
                    <SelectItem key={font} value={font}>
                      {font}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || saving}
            onClick={() => setFontBrowserOpen(true)}
          >
            {t("openSlideFonts.browse")}
          </Button>
          <OpenSlideFontBrowser
            open={fontBrowserOpen}
            onOpenChange={setFontBrowserOpen}
            disabled={disabled || saving}
            onApply={(font, target) =>
              update(
                target === "display"
                  ? {
                      displayFont: font.family,
                      displayFontAssetId: font.assetId,
                    }
                  : {
                      bodyFont: font.family,
                      bodyFontAssetId: font.assetId,
                    },
              )
            }
          />
          <SliderField
            label={t("openSlideDesignTokens.heroScale")}
            value={draft.heroScale}
            min={0.5}
            max={2}
            step={0.05}
            disabled={disabled || saving}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={(value) => update({ heroScale: value })}
          />
          <SliderField
            label={t("openSlideDesignTokens.bodyScale")}
            value={draft.bodyScale}
            min={0.5}
            max={2}
            step={0.05}
            disabled={disabled || saving}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={(value) => update({ bodyScale: value })}
          />
        </section>

        <section className="grid gap-3 py-4">
          <h3 className="text-xs font-medium text-foreground">
            {t("openSlideDesignTokens.shape")}
          </h3>
          <SliderField
            label={t("openSlideDesignTokens.radius")}
            value={draft.radius}
            min={0}
            max={48}
            step={1}
            disabled={disabled || saving}
            onChange={(value) => update({ radius: value })}
          />
        </section>
      </div>
      <div className="grid gap-2 border-t border-border p-3">
        {saveError ? (
          <p className="text-xs text-destructive" role="alert">
            {saveError}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || disabled || saving}
        >
          {saving
            ? t("designSystemSetup.saving")
            : t("designSystemSetup.saveChanges")}
        </Button>
      </div>
    </aside>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  formatValue = (next) => `${next}px`,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{formatValue(value)}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next);
        }}
        aria-label={label}
      />
    </div>
  );
}
