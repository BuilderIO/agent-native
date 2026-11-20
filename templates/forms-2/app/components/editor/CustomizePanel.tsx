import { useT } from "@agent-native/core/client/i18n";
import {
  formThemeSchema,
  MAX_CUSTOM_CSS_BYTES,
  resolveTheme,
  THEME_FONTS,
  THEME_PRESETS,
  type FormTheme,
} from "@shared/theme/form-theme";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBarDown,
  IconArrowBarToRight,
  IconArrowsHorizontal,
  IconHelp,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useId } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  ColorField,
  Field,
  Section,
  SegmentedRadio,
  UnitField,
  UnitInput,
} from "./customize/fields";
import { ImageUpload } from "./customize/ImageUpload";
import type { useFormTheme } from "./use-form-theme";

const COLOR_KEYS: ReadonlySet<string> = new Set([
  "background",
  "text",
  "buttonBackground",
  "buttonText",
  "accent",
  "inputBackground",
  "inputPlaceholder",
  "inputBorderColor",
]);

const iconClass = "size-4";

export function CustomizePanel({
  state,
  onClose,
}: {
  state: ReturnType<typeof useFormTheme>;
  onClose: () => void;
}) {
  const t = useT();
  const cssId = useId();
  const resolved = resolveTheme(state.theme);
  const change = (patch: FormTheme) =>
    state.changeTheme({ ...state.theme, ...patch });
  const clear = (...keys: (keyof FormTheme)[]) =>
    state.changeTheme(
      formThemeSchema.parse(
        Object.fromEntries(
          Object.entries(state.theme ?? {}).filter(
            ([key]) => !keys.some((cleared) => cleared === key),
          ),
        ),
      ),
    );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      aria-label={t("forms.customize.title")}
      className="fixed top-[62px] right-3.5 bottom-3.5 z-30 flex w-[400px] max-w-[calc(100vw-28px)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <div className="flex shrink-0 items-center justify-between px-[21px] pt-[17px] pb-[39px]">
        <h2 className="text-sm font-semibold">{t("forms.customize.title")}</h2>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("forms.customize.help")}
                className="flex size-[18px] items-center justify-center hover:text-foreground"
              >
                <IconHelp className="size-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[300px]">
              {t("forms.customize.cssHelp")}
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            aria-label={t("forms.customize.close")}
            onClick={onClose}
            className="flex size-[18px] items-center justify-center hover:text-foreground"
          >
            <IconX className="size-[18px]" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-[9px] px-[21px] pb-5">
          <Field label={t("forms.customize.theme")}>
            {(id) => (
              <Select
                value={resolved.preset}
                onValueChange={(preset) => {
                  const next = THEME_PRESETS.find((p) => p === preset);
                  if (!next) return;
                  state.changeTheme(
                    formThemeSchema.parse({
                      ...Object.fromEntries(
                        Object.entries(state.theme ?? {}).filter(
                          ([key]) => !COLOR_KEYS.has(key),
                        ),
                      ),
                      preset: next,
                    }),
                  );
                }}
              >
                <SelectTrigger id={id} className="h-[29px] text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">
                    {t("forms.customize.themeLight")}
                  </SelectItem>
                  <SelectItem value="dark">
                    {t("forms.customize.themeDark")}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label={t("forms.customize.font")}>
            {(id) => (
              <Select
                value={resolved.font}
                onValueChange={(value) => {
                  const font = THEME_FONTS.find((f) => f === value);
                  if (font) change({ font });
                }}
              >
                <SelectTrigger id={id} className="h-[29px] text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THEME_FONTS.map((font) => (
                    <SelectItem key={font} value={font}>
                      {font}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-x-[9px] gap-y-[9px]">
            <ColorField
              label={t("forms.customize.background")}
              value={resolved.background}
              onChange={(background) => change({ background })}
            />
            <Field label={t("forms.customize.backgroundImage")}>
              {() => (
                <ImageUpload
                  uploadLabel={t("forms.customize.uploadBackgroundImage")}
                  removeLabel={t("forms.customize.removeBackgroundImage")}
                  url={resolved.backgroundImageUrl}
                  onUploaded={(backgroundImageUrl) =>
                    change({ backgroundImageUrl })
                  }
                  onRemove={() =>
                    clear(
                      "backgroundImageUrl",
                      "backgroundImageSize",
                      "backgroundImageAttachment",
                    )
                  }
                >
                  <span className="truncate">
                    {t("forms.customize.uploadBackgroundImage")}
                  </span>
                </ImageUpload>
              )}
            </Field>
            <ColorField
              label={t("forms.customize.text")}
              value={resolved.text}
              onChange={(text) => change({ text })}
            />
            <ColorField
              label={t("forms.customize.accent")}
              value={resolved.accent}
              onChange={(accent) => change({ accent })}
            />
            <ColorField
              label={t("forms.customize.buttonBackground")}
              value={resolved.buttonBackground}
              onChange={(buttonBackground) => change({ buttonBackground })}
            />
            <ColorField
              label={t("forms.customize.buttonText")}
              value={resolved.buttonText}
              onChange={(buttonText) => change({ buttonText })}
            />
          </div>
          {resolved.backgroundImageUrl ? (
            <div className="grid grid-cols-2 gap-x-[9px]">
              <Field label={t("forms.customize.backgroundSize")}>
                {(id) => (
                  <Select
                    value={resolved.backgroundImageSize}
                    onValueChange={(value) => {
                      if (value === "cover" || value === "contain")
                        change({ backgroundImageSize: value });
                    }}
                  >
                    <SelectTrigger id={id} className="h-[29px] text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cover">
                        {t("forms.customize.sizeCover")}
                      </SelectItem>
                      <SelectItem value="contain">
                        {t("forms.customize.sizeContain")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label={t("forms.customize.backgroundPosition")}>
                {(id) => (
                  <Select
                    value={resolved.backgroundImageAttachment}
                    onValueChange={(value) => {
                      if (value === "fixed" || value === "scroll")
                        change({ backgroundImageAttachment: value });
                    }}
                  >
                    <SelectTrigger id={id} className="h-[29px] text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">
                        {t("forms.customize.positionFixed")}
                      </SelectItem>
                      <SelectItem value="scroll">
                        {t("forms.customize.positionScroll")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </div>
          ) : null}
        </div>
        <div className="border-t border-border px-[21px] pt-[17px] pb-2">
          <h3 className="mb-[18px] text-[13px] font-semibold">
            {t("forms.customize.advanced")}
          </h3>
          <Section title={t("forms.customize.layout")}>
            <div className="grid grid-cols-2 gap-x-[9px]">
              <UnitField
                label={t("forms.customize.pageWidth")}
                value={resolved.pageWidth}
                min={320}
                max={1200}
                onChange={(pageWidth) => change({ pageWidth })}
              />
              <UnitField
                label={t("forms.customize.baseFontSize")}
                value={resolved.baseFontSize}
                min={12}
                max={24}
                onChange={(baseFontSize) => change({ baseFontSize })}
              />
            </div>
            <div className="grid grid-cols-[34px_1fr_1fr_1fr] gap-x-[9px]">
              <Field label={t("forms.customize.logo")}>
                {() => (
                  <ImageUpload
                    uploadLabel={t("forms.customize.uploadLogo")}
                    removeLabel={t("forms.customize.removeLogo")}
                    url={resolved.logoUrl}
                    onUploaded={(logoUrl) => change({ logoUrl })}
                    onRemove={() => clear("logoUrl")}
                  />
                )}
              </Field>
              <UnitField
                label={t("forms.customize.width")}
                value={resolved.logoWidth}
                min={16}
                max={400}
                onChange={(logoWidth) => change({ logoWidth })}
              />
              <UnitField
                label={t("forms.customize.height")}
                value={resolved.logoHeight}
                min={16}
                max={400}
                onChange={(logoHeight) => change({ logoHeight })}
              />
              <UnitField
                label={t("forms.customize.cornerRadius")}
                value={resolved.logoRadius}
                min={0}
                max={200}
                onChange={(logoRadius) => change({ logoRadius })}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-[9px]">
              <Field label={t("forms.customize.cover")}>
                {() => (
                  <ImageUpload
                    uploadLabel={t("forms.customize.uploadCover")}
                    removeLabel={t("forms.customize.removeCover")}
                    url={resolved.coverUrl}
                    onUploaded={(coverUrl) => change({ coverUrl })}
                    onRemove={() => clear("coverUrl")}
                  />
                )}
              </Field>
              <UnitField
                label={t("forms.customize.height")}
                unit="%"
                value={resolved.coverHeight}
                min={5}
                max={100}
                onChange={(coverHeight) => change({ coverHeight })}
              />
            </div>
          </Section>
          <Section title={t("forms.customize.inputs")}>
            <div className="grid grid-cols-[3fr_2fr] gap-x-[9px]">
              <Field label={t("forms.customize.width")}>
                {(id) => (
                  <div className="flex gap-[9px]">
                    <SegmentedRadio
                      label={t("forms.customize.widthMode")}
                      value={resolved.inputWidthMode}
                      options={[
                        {
                          value: "full",
                          label: t("forms.customize.modeFull"),
                          icon: <IconArrowsHorizontal className={iconClass} />,
                        },
                        {
                          value: "fixed",
                          label: t("forms.customize.modeFixed"),
                          icon: <IconArrowBarDown className={iconClass} />,
                        },
                      ]}
                      onChange={(inputWidthMode) => change({ inputWidthMode })}
                    />
                    <UnitInput
                      id={id}
                      value={resolved.inputWidth}
                      min={80}
                      max={1200}
                      shown={
                        resolved.inputWidthMode === "full" ? "100%" : undefined
                      }
                      onChange={(inputWidth) => change({ inputWidth })}
                    />
                  </div>
                )}
              </Field>
              <UnitField
                label={t("forms.customize.height")}
                value={resolved.inputHeight}
                min={24}
                max={120}
                onChange={(inputHeight) => change({ inputHeight })}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-[9px]">
              <ColorField
                label={t("forms.customize.background")}
                value={resolved.inputBackground}
                onChange={(inputBackground) => change({ inputBackground })}
              />
              <ColorField
                label={t("forms.customize.placeholder")}
                value={resolved.inputPlaceholder}
                onChange={(inputPlaceholder) => change({ inputPlaceholder })}
              />
            </div>
            <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-[9px]">
              <ColorField
                label={t("forms.customize.border")}
                value={resolved.inputBorderColor}
                onChange={(inputBorderColor) => change({ inputBorderColor })}
              />
              <UnitField
                label={t("forms.customize.width")}
                value={resolved.inputBorderWidth}
                min={0}
                max={8}
                onChange={(inputBorderWidth) => change({ inputBorderWidth })}
              />
              <UnitField
                label={t("forms.customize.radius")}
                value={resolved.fieldRadius}
                min={0}
                max={50}
                onChange={(fieldRadius) => change({ fieldRadius })}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-[9px]">
              <UnitField
                label={t("forms.customize.marginBottom")}
                value={resolved.inputMarginBottom}
                min={0}
                max={100}
                onChange={(inputMarginBottom) => change({ inputMarginBottom })}
              />
              <UnitField
                label={t("forms.customize.horizontalPadding")}
                value={resolved.inputPaddingX}
                min={0}
                max={60}
                onChange={(inputPaddingX) => change({ inputPaddingX })}
              />
            </div>
          </Section>
          <Section title={t("forms.customize.buttons")}>
            <div className="grid grid-cols-[3fr_2fr] gap-x-[9px]">
              <Field label={t("forms.customize.width")}>
                {(id) => (
                  <div className="flex gap-[9px]">
                    <SegmentedRadio
                      label={t("forms.customize.widthMode")}
                      value={resolved.buttonWidthMode}
                      options={[
                        {
                          value: "auto",
                          label: t("forms.customize.modeAuto"),
                          icon: <IconArrowBarToRight className={iconClass} />,
                        },
                        {
                          value: "full",
                          label: t("forms.customize.modeFull"),
                          icon: <IconArrowsHorizontal className={iconClass} />,
                        },
                        {
                          value: "fixed",
                          label: t("forms.customize.modeFixed"),
                          icon: <IconArrowBarDown className={iconClass} />,
                        },
                      ]}
                      onChange={(buttonWidthMode) =>
                        change({ buttonWidthMode })
                      }
                    />
                    <UnitInput
                      id={id}
                      value={resolved.buttonWidth}
                      min={40}
                      max={1200}
                      shown={
                        resolved.buttonWidthMode === "auto"
                          ? "auto"
                          : resolved.buttonWidthMode === "full"
                            ? "100%"
                            : undefined
                      }
                      onChange={(buttonWidth) => change({ buttonWidth })}
                    />
                  </div>
                )}
              </Field>
              <UnitField
                label={t("forms.customize.height")}
                value={resolved.buttonHeight}
                min={24}
                max={120}
                onChange={(buttonHeight) => change({ buttonHeight })}
              />
            </div>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-x-[9px]">
              <div>
                <span className="mb-1 block text-[11px] leading-[14px] text-muted-foreground">
                  {t("forms.customize.alignment")}
                </span>
                <SegmentedRadio
                  label={t("forms.customize.alignment")}
                  value={resolved.buttonAlign}
                  options={[
                    {
                      value: "left",
                      label: t("forms.customize.alignLeft"),
                      icon: <IconAlignLeft className={iconClass} />,
                    },
                    {
                      value: "center",
                      label: t("forms.customize.alignCenter"),
                      icon: <IconAlignCenter className={iconClass} />,
                    },
                    {
                      value: "right",
                      label: t("forms.customize.alignRight"),
                      icon: <IconAlignRight className={iconClass} />,
                    },
                  ]}
                  onChange={(buttonAlign) => change({ buttonAlign })}
                />
              </div>
              <UnitField
                label={t("forms.customize.fontSize")}
                value={resolved.buttonFontSize}
                min={10}
                max={40}
                onChange={(buttonFontSize) => change({ buttonFontSize })}
              />
              <UnitField
                label={t("forms.customize.cornerRadius")}
                value={resolved.buttonRadius}
                min={0}
                max={50}
                onChange={(buttonRadius) => change({ buttonRadius })}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-[9px]">
              <ColorField
                label={t("forms.customize.background")}
                value={resolved.buttonBackground}
                onChange={(buttonBackground) => change({ buttonBackground })}
              />
              <ColorField
                label={t("forms.customize.text")}
                value={resolved.buttonText}
                onChange={(buttonText) => change({ buttonText })}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-[9px]">
              <UnitField
                label={t("forms.customize.verticalMargin")}
                value={resolved.buttonMarginY}
                min={0}
                max={100}
                onChange={(buttonMarginY) => change({ buttonMarginY })}
              />
              <UnitField
                label={t("forms.customize.horizontalPadding")}
                value={resolved.buttonPaddingX}
                min={0}
                max={80}
                onChange={(buttonPaddingX) => change({ buttonPaddingX })}
              />
            </div>
          </Section>
        </div>
        <div className="border-t border-border pt-[17px]">
          <label
            htmlFor={cssId}
            className="block px-[21px] pb-3 text-[13px] font-semibold"
          >
            {t("forms.customize.customCss")}
          </label>
          <Textarea
            id={cssId}
            value={state.customCss}
            spellCheck={false}
            aria-invalid={state.cssTooLarge}
            onChange={(event) => state.changeCss(event.target.value)}
            placeholder=".forms-root { }"
            className="h-48 resize-y rounded-none border-0 bg-[var(--forms-code-bg)] px-[21px] py-3 font-mono text-xs leading-5 text-[color:var(--forms-code-text)] placeholder:text-[color:var(--forms-code-placeholder)] focus-visible:ring-0"
          />
          {state.cssTooLarge ? (
            <p
              role="alert"
              className="px-[21px] py-1.5 text-xs text-destructive"
            >
              {t("forms.customize.cssTooLarge", {
                limit: MAX_CUSTOM_CSS_BYTES / 1024,
              })}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
