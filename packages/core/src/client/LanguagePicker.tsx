import {
  Picker,
  useDesignSystemComponent,
} from "@agent-native/toolkit/design-system";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { IconCheck, IconChevronDown, IconLanguage } from "@tabler/icons-react";
import { useState } from "react";

import {
  DEFAULT_LOCALE,
  localeDisplayName,
  normalizeLocalizationPreference,
  resolveLocaleFromCandidates,
  type LocaleCode,
  type LocalePreference,
} from "../localization/shared.js";
import { useLocale } from "./i18n.js";
import { cn } from "./utils.js";

const LANGUAGE_PICKER_COPY: Record<
  LocaleCode,
  { label: string; system: string; systemDescription: string }
> = {
  "en-US": {
    label: "Language",
    system: "System",
    systemDescription: "Use your browser language",
  },
  "zh-CN": {
    label: "语言",
    system: "系统",
    systemDescription: "使用浏览器语言",
  },
  "zh-TW": {
    label: "語言",
    system: "系統",
    systemDescription: "使用瀏覽器語言",
  },
  "es-ES": {
    label: "Idioma",
    system: "Sistema",
    systemDescription: "Usar el idioma del navegador",
  },
  "fr-FR": {
    label: "Langue",
    system: "Système",
    systemDescription: "Utiliser la langue du navigateur",
  },
  "de-DE": {
    label: "Sprache",
    system: "System",
    systemDescription: "Browsersprache verwenden",
  },
  "ja-JP": {
    label: "言語",
    system: "システム",
    systemDescription: "ブラウザーの言語を使用",
  },
  "ko-KR": {
    label: "언어",
    system: "시스템",
    systemDescription: "브라우저 언어 사용",
  },
  "pt-BR": {
    label: "Idioma",
    system: "Sistema",
    systemDescription: "Usar o idioma do navegador",
  },
  "hi-IN": {
    label: "भाषा",
    system: "सिस्टम",
    systemDescription: "ब्राउज़र की भाषा का उपयोग करें",
  },
  "ar-SA": {
    label: "اللغة",
    system: "النظام",
    systemDescription: "استخدام لغة المتصفح",
  },
};

function browserLanguageCandidates(): string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length
    ? [...navigator.languages]
    : navigator.language
      ? [navigator.language]
      : [];
}

export function LanguagePicker({
  className,
  includeSystem = true,
  label,
  size = "default",
  variant = "select",
}: {
  className?: string;
  includeSystem?: boolean;
  label?: string;
  /** The `select` trigger's height, matching `SelectTrigger`'s sizes. */
  size?: "sm" | "default";
  variant?: "select" | "icon" | "ghost-icon";
}) {
  const {
    locale,
    preference,
    setPreference,
    supportedLocales,
    localeMetadata,
  } = useLocale();
  const [open, setOpen] = useState(false);
  const copy =
    LANGUAGE_PICKER_COPY[locale] ?? LANGUAGE_PICKER_COPY[DEFAULT_LOCALE];
  const systemCopy =
    LANGUAGE_PICKER_COPY[
      resolveLocaleFromCandidates(browserLanguageCandidates())
    ] ?? LANGUAGE_PICKER_COPY[DEFAULT_LOCALE];
  const resolvedLabel = label ?? copy.label;
  const options = [
    ...(includeSystem
      ? [
          {
            value: "system" as const,
            label: systemCopy.system,
            description: systemCopy.systemDescription,
          },
        ]
      : []),
    ...supportedLocales.map((code) => ({
      value: code,
      label: localeDisplayName(code, localeMetadata),
      description: code,
    })),
  ];
  const selected = options.find((option) => option.value === preference);
  const selectedLabel = selected?.label ?? preference;
  const triggerLabel = `${resolvedLabel}: ${selectedLabel}`;
  const customPicker = useDesignSystemComponent("Picker");

  function handleOptionClick(value: LocalePreference) {
    setOpen(false);
    void setPreference(normalizeLocalizationPreference(value).locale);
  }

  if (variant === "select" && customPicker) {
    return (
      <Picker<LocalePreference>
        mode="select"
        options={options}
        value={preference}
        onChange={(value) => {
          if (value == null) return;
          void setPreference(normalizeLocalizationPreference(value).locale);
        }}
        placeholder={selectedLabel}
        aria-label={triggerLabel}
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={triggerLabel}
            title={triggerLabel}
            data-language-picker-trigger
            className={cn(
              "shrink-0 rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              variant === "ghost-icon"
                ? "flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                : "border border-border bg-background text-foreground hover:border-foreground/30 hover:bg-accent/40 hover:text-foreground data-[state=open]:border-foreground/30 data-[state=open]:bg-accent/40",
              variant === "icon"
                ? "flex h-8 w-8 items-center justify-center"
                : variant === "select"
                  ? cn(
                      "flex w-full items-center justify-between gap-2 px-3 text-start text-sm",
                      size === "sm" ? "h-8" : "h-9",
                    )
                  : null,
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <IconLanguage className="h-4 w-4 shrink-0 text-muted-foreground" />
              {variant === "select" ? (
                <span className="truncate">{selectedLabel}</span>
              ) : (
                <span className="sr-only">{triggerLabel}</span>
              )}
            </span>
            {variant === "select" ? (
              <IconChevronDown
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : null}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align={variant === "select" ? "start" : "end"}
            sideOffset={6}
            role="menu"
            className={cn(
              // compositing-ok: popover content unmounts on close.
              "z-[9999] max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none will-change-[transform,opacity] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:duration-100 data-[state=open]:duration-150 data-[state=closed]:ease-in data-[state=open]:ease-out data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
              variant === "icon" || variant === "ghost-icon"
                ? "min-w-56"
                : "w-[min(20rem,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)]",
            )}
          >
            {options.map((option) => {
              const optionSelected = option.value === preference;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={optionSelected}
                  title={option.description}
                  onClick={() => handleOptionClick(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground",
                    optionSelected
                      ? "bg-accent/40 text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <IconCheck
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      optionSelected ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
