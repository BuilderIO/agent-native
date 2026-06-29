import * as PopoverPrimitive from "@radix-ui/react-popover";
import { IconCheck, IconChevronDown, IconLanguage } from "@tabler/icons-react";
import i18next, { type i18n as I18nInstance } from "i18next";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";

import defaultEnglishMessages from "../localization/default-messages.js";
import {
  DEFAULT_LOCALE,
  LOCALE_HYDRATION_GLOBAL,
  LOCALE_METADATA,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  localeDirection,
  normalizeLocalizationPreference,
  resolveLocaleFromCandidates,
  resolveLocaleFromPreference,
  type LocaleCode,
  type LocaleMetadata,
  type LocalePreference,
  type LocalizationPreference,
} from "../localization/shared.js";
import { setClientAppState } from "./application-state.js";
import { callAction } from "./use-action.js";
import { cn } from "./utils.js";

export {
  DEFAULT_LOCALE,
  LOCALE_HYDRATION_GLOBAL,
  LOCALE_METADATA,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  localeDirection,
  normalizeLocaleCode,
  normalizeLocalePreference,
  normalizeLocalizationPreference,
  resolveLocaleFromCandidates,
  resolveLocaleFromPreference,
  type LocaleCode,
  type LocaleMetadata,
  type LocalePreference,
  type LocalizationPreference,
} from "../localization/shared.js";
export { getLocaleInitScript } from "../localization/server.js";

export type LocaleMessages = Record<string, unknown>;

export interface LocaleHydrationPayload {
  locale?: LocaleCode;
  preference?: LocalizationPreference;
  dir?: "ltr" | "rtl";
  messages?: LocaleMessages;
}

export interface AgentNativeI18nCatalog {
  namespace?: string;
  sourceLocale?: LocaleCode;
  messages?: LocaleMessages;
  loadMessages?: (locale: LocaleCode) => Promise<LocaleMessages | null>;
}

export interface AgentNativeI18nProviderProps {
  children: React.ReactNode;
  catalog?: AgentNativeI18nCatalog;
  initialLocale?: LocaleCode;
  initialPreference?: LocalizationPreference | LocalePreference;
  initialMessages?: LocaleMessages | null;
  persistPreference?: boolean;
}

interface LocaleContextValue {
  locale: LocaleCode;
  sourceLocale: LocaleCode;
  preference: LocalePreference;
  dir: "ltr" | "rtl";
  metadata: LocaleMetadata;
  setPreference: (preference: LocalePreference) => Promise<void>;
  loading: boolean;
}

declare global {
  interface Window {
    __AGENT_NATIVE_LOCALE__?: LocaleHydrationPayload;
  }
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

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

function readStoredPreference(): LocalePreference | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeLocalizationPreference(
      window.localStorage.getItem(LOCALE_STORAGE_KEY),
    ).locale;
  } catch {
    return null;
  }
}

function writeStoredPreference(preference: LocalePreference) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference);
  } catch {
    // Ignore storage-denied browsers; the in-memory provider state still works.
  }
}

function readHydrationPayload(): LocaleHydrationPayload {
  if (typeof window === "undefined") return {};
  return window[LOCALE_HYDRATION_GLOBAL] ?? {};
}

function resolveInitialState(args: {
  initialLocale?: LocaleCode;
  initialPreference?: LocalizationPreference | LocalePreference;
}): { locale: LocaleCode; preference: LocalePreference } {
  const hydration = readHydrationPayload();
  const preference = normalizeLocalizationPreference(
    args.initialPreference ?? hydration.preference ?? readStoredPreference(),
  ).locale;
  const locale =
    args.initialLocale ??
    hydration.locale ??
    resolveLocaleFromPreference(preference, browserLanguageCandidates());
  return { locale, preference };
}

function normalizeLoadedMessages(value: unknown): LocaleMessages | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const maybeDefault = (value as { default?: unknown }).default;
  if (
    maybeDefault &&
    typeof maybeDefault === "object" &&
    !Array.isArray(maybeDefault)
  ) {
    return maybeDefault as LocaleMessages;
  }
  return value as LocaleMessages;
}

function createI18nInstance(args: {
  namespace: string;
  sourceLocale: LocaleCode;
  messages: LocaleMessages;
  initialLocale: LocaleCode;
  initialMessages?: LocaleMessages | null;
}): I18nInstance {
  const instance = i18next.createInstance();
  const resources: Record<string, Record<string, LocaleMessages>> = {
    [args.sourceLocale]: {
      [args.namespace]: args.messages,
    },
  };
  if (args.initialLocale !== args.sourceLocale && args.initialMessages) {
    resources[args.initialLocale] = {
      [args.namespace]: args.initialMessages,
    };
  }
  void instance.use(initReactI18next).init({
    resources,
    lng: args.initialLocale,
    fallbackLng: args.sourceLocale,
    defaultNS: args.namespace,
    ns: [args.namespace],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    returnNull: false,
    initAsync: false,
  });
  return instance;
}

export function AgentNativeI18nProvider({
  children,
  catalog,
  initialLocale,
  initialPreference,
  initialMessages,
  persistPreference = true,
}: AgentNativeI18nProviderProps) {
  const namespace = catalog?.namespace ?? "translation";
  const sourceLocale = catalog?.sourceLocale ?? DEFAULT_LOCALE;
  const sourceMessages = catalog?.messages ?? {};
  const loadMessages = catalog?.loadMessages;
  const hydration = readHydrationPayload();
  const initialState = useMemo(
    () => resolveInitialState({ initialLocale, initialPreference }),
    [initialLocale, initialPreference],
  );
  const [preference, setPreferenceState] = useState<LocalePreference>(
    initialState.preference,
  );
  const [locale, setLocale] = useState<LocaleCode>(initialState.locale);
  const [loading, setLoading] = useState(false);
  const i18nRef = useRef<I18nInstance | null>(null);

  if (!i18nRef.current) {
    const preloadedMessages = normalizeLoadedMessages(
      hydration.locale === initialState.locale && hydration.messages
        ? hydration.messages
        : initialMessages,
    );
    i18nRef.current = createI18nInstance({
      namespace,
      sourceLocale,
      messages:
        hydration.locale === sourceLocale && hydration.messages
          ? hydration.messages
          : sourceMessages,
      initialLocale: initialState.locale,
      initialMessages: preloadedMessages,
    });
  }

  const i18n = i18nRef.current;

  useEffect(() => {
    if (i18n.hasResourceBundle(sourceLocale, namespace)) {
      i18n.addResourceBundle(
        sourceLocale,
        namespace,
        sourceMessages,
        true,
        true,
      );
    }
  }, [i18n, namespace, sourceLocale, sourceMessages]);

  useEffect(() => {
    const nextLocale =
      preference === "system"
        ? resolveLocaleFromCandidates(browserLanguageCandidates())
        : preference;
    setLocale(nextLocale);
  }, [preference]);

  useEffect(() => {
    let cancelled = false;

    async function applyLocale() {
      setLoading(true);
      try {
        if (
          locale !== sourceLocale &&
          !i18n.hasResourceBundle(locale, namespace)
        ) {
          const preloaded =
            hydration.locale === locale && hydration.messages
              ? hydration.messages
              : initialLocale === locale && initialMessages
                ? initialMessages
                : null;
          const loaded = preloaded ?? (await loadMessages?.(locale));
          const messages = normalizeLoadedMessages(loaded);
          if (messages) {
            i18n.addResourceBundle(locale, namespace, messages, true, true);
          }
        }
        if (!cancelled) {
          await i18n.changeLanguage(locale);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void applyLocale();
    return () => {
      cancelled = true;
    };
  }, [
    hydration.locale,
    hydration.messages,
    i18n,
    initialLocale,
    initialMessages,
    loadMessages,
    locale,
    namespace,
    sourceLocale,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const dir = localeDirection(locale);
    const root = document.documentElement;
    root.setAttribute("lang", locale);
    root.setAttribute("dir", dir);
    root.setAttribute("data-locale", locale);
  }, [locale]);

  useEffect(() => {
    if (!persistPreference) return;
    let cancelled = false;
    callAction<LocalizationPreference>(
      "get-localization-preference",
      undefined,
      { method: "GET" },
    )
      .then((value) => {
        if (cancelled) return;
        const normalized = normalizeLocalizationPreference(value).locale;
        setPreferenceState(normalized);
        writeStoredPreference(normalized);
      })
      .catch(() => {
        // Anonymous/public routes use localStorage/browser language only.
      });
    return () => {
      cancelled = true;
    };
  }, [persistPreference]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY || event.newValue == null) return;
      setPreferenceState(
        normalizeLocalizationPreference(event.newValue).locale,
      );
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    void setClientAppState(
      "localization",
      {
        locale,
        preference,
        dir: localeDirection(locale),
      },
      { requestSource: "localization" },
    ).catch(() => {
      // Public/anonymous pages cannot write app-state; localization still works.
    });
  }, [locale, preference]);

  const setPreference = useCallback(
    async (next: LocalePreference) => {
      const normalized = normalizeLocalizationPreference(next).locale;
      setPreferenceState(normalized);
      writeStoredPreference(normalized);
      if (!persistPreference) return;
      try {
        await callAction<LocalizationPreference>(
          "set-localization-preference",
          {
            locale: normalized,
          },
        );
      } catch (error) {
        const status = (error as { status?: unknown })?.status;
        if (status !== 401 && status !== 403) {
          throw error;
        }
      }
    },
    [persistPreference],
  );

  const context = useMemo<LocaleContextValue>(
    () => ({
      locale,
      sourceLocale,
      preference,
      dir: localeDirection(locale),
      metadata: LOCALE_METADATA[locale],
      setPreference,
      loading,
    }),
    [loading, locale, preference, setPreference, sourceLocale],
  );

  return (
    <LocaleContext.Provider value={context}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error("useLocale must be used within AgentNativeI18nProvider");
  }
  return value;
}

export function useOptionalLocale(): LocaleContextValue | null {
  return useContext(LocaleContext);
}

const CORE_FALLBACK_MESSAGES: Record<string, string> = {
  "runsTray.runs": "Runs",
  "runsTray.agentRuns": "Agent runs",
  "runsTray.activeRun_one": "{{count}} active run",
  "runsTray.activeRun_other": "{{count}} active runs",
  "runsTray.failedRun_one": "{{count}} failed run",
  "runsTray.failedRun_other": "{{count}} failed runs",
  "runsTray.recentRuns": "Recent runs",
  "runsTray.noRecentRuns": "No recent runs",
  "runsTray.ariaAgentRuns": "Agent runs, {{label}}",
  "runsTray.summaryRunning": "{{activeCount}} running",
  "runsTray.summaryRunningRecent":
    "{{activeCount}} running · {{terminalCount}} recent",
  "runsTray.summaryRecent_one": "{{count}} recent run",
  "runsTray.summaryRecent_other": "{{count}} recent runs",
  "runsTray.noTrackedWorkYet": "No tracked work yet",
  "runsTray.emptyDescription":
    "Background agent work will appear here while it runs and after it finishes.",
  "runsTray.open": "Open",
  "runsTray.stopRun": "Stop {{title}}",
  "runsTray.hideRun": "Hide {{title}}",
  "runsTray.statusRunning": "Running",
  "runsTray.statusDone": "Done",
  "runsTray.statusFailed": "Failed",
  "runsTray.statusStopped": "Stopped",
  "runsTray.updatedJustNow": "Updated just now",
  "runsTray.finishedJustNow": "Finished just now",
  "runsTray.updatedMinutes": "Updated {{count}}m ago",
  "runsTray.finishedMinutes": "Finished {{count}}m ago",
  "runsTray.updatedHours": "Updated {{count}}h ago",
  "runsTray.finishedHours": "Finished {{count}}h ago",
  "runsTray.updatedDate": "Updated {{date}}",
  "runsTray.finishedDate": "Finished {{date}}",
  "codeRequired.fallbackDetail":
    "Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like.",
  "codeRequired.defaultFeature": "Make the requested code changes to this app",
  "codeRequired.branchError": "Failed to create branch",
  "codeRequired.title": "Code changes required",
  "codeRequired.subtitleWithFeature":
    '"{{feature}}" creates or modifies source code, which needs Desktop or Builder from this surface.',
  "codeRequired.subtitle":
    "This action creates or modifies source code, which needs Desktop or Builder from this surface.",
  "codeRequired.desktopTitle": "Use Agent Native Desktop",
  "codeRequired.desktopDescription":
    "Open the project in the desktop app to enable source edits and CLI access.",
  "codeRequired.builderAgentTitle": "Use Builder.io Agent",
  "codeRequired.builderAgentDescription":
    "Let our cloud agent make the changes for you. You'll get a link to preview and deploy.",
  "codeRequired.codeChangeTitle": "This requires a code change",
  "codeRequired.codeChangeBadge": "Code change",
  "codeRequired.connectBuilderTitle": "Connect Builder.io",
  "codeRequired.connectBuilderDescription":
    "Connect Builder to enable cloud-based code changes from this app.",
  "codeRequired.setupRequired": "Setup required",
  "codeRequired.branchCreated": "Branch created",
  "codeRequired.close": "Close",
  "agentPanel.useBuilder": "Use Builder",
  "agentPanel.openDesktopToEditCode": "Open Desktop to edit code",
  "agentPanel.codeUnavailableDescription":
    "Source-code changes and CLI access are available in the Agent Native Desktop app.",
  "agentPanel.downloadDesktop": "Download Desktop",
  "agentPanel.chatMode": "Chat mode",
  "agentPanel.chat": "Chat",
  "agentPanel.cliTerminalMode": "CLI terminal mode",
  "agentPanel.cli": "CLI",
  "agentPanel.workspaceMode": "Workspace files, agents, skills, and tasks",
  "agentPanel.workspace": "Workspace",
  "agentPanel.newChat": "New chat",
  "agentPanel.newTerminal": "New terminal",
  "agentPanel.panelOptions": "Agent panel options",
  "agentPanel.collapseSidebar": "Collapse sidebar",
  "agentPanel.hideChats": "Hide chats",
  "agentPanel.allChats": "All chats",
  "agentPanel.settings": "Settings",
  "agentPanel.feedback": "Feedback",
  "agentPanel.exitFullscreen": "Exit fullscreen",
  "agentPanel.fullscreen": "Fullscreen",
  "agentPanel.closeTab": "Close tab",
  "agentPanel.closeOtherTabs": "Close other tabs",
  "agentPanel.closeAllTabs": "Close all tabs",
  "agentPanel.clearChat": "Clear chat",
  "agentPanel.cliRequiresDevMode": "CLI requires dev mode",
  "agentPanel.cliRequiresDevModeDescription":
    "Run this app locally with pnpm dev or use Builder.io to access the CLI terminal.",
  "agentPanel.toggleAgent": "Toggle agent",
};

function flattenMessages(
  value: unknown,
  prefix = "",
  out: Record<string, string> = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      out[nextKey] = child;
    } else {
      flattenMessages(child, nextKey, out);
    }
  }
  return out;
}

const DEFAULT_ENGLISH_MESSAGES = flattenMessages(defaultEnglishMessages);

function interpolateFallbackMessage(
  template: string,
  options?: Record<string, unknown>,
) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = options?.[name];
    return value == null ? "" : String(value);
  });
}

function humanizeFallbackKey(key: string) {
  const lastSegment = key.split(".").filter(Boolean).pop() ?? key;
  const words = lastSegment
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function fallbackMessage(key: string, options?: Record<string, unknown>) {
  const count = Number(options?.count);
  const pluralKey =
    Number.isFinite(count) && count === 1 ? `${key}_one` : `${key}_other`;
  const template =
    DEFAULT_ENGLISH_MESSAGES[pluralKey] ??
    DEFAULT_ENGLISH_MESSAGES[key] ??
    CORE_FALLBACK_MESSAGES[pluralKey] ??
    CORE_FALLBACK_MESSAGES[key];
  return template
    ? interpolateFallbackMessage(template, options)
    : humanizeFallbackKey(key);
}

export function useT() {
  const { i18n, t } = useTranslation();
  const context = useContext(LocaleContext);
  const sourceLocale = context?.sourceLocale ?? DEFAULT_LOCALE;
  return useCallback(
    (key: string, options?: Record<string, unknown>) => {
      const translated = t(key, options);
      if (translated !== key) return translated;
      const getFixedT = (
        i18n as { getFixedT?: (locale: LocaleCode) => typeof t }
      ).getFixedT;
      const sourceFallback = getFixedT?.(sourceLocale)(key, options);
      if (sourceFallback && sourceFallback !== key) return sourceFallback;
      return fallbackMessage(key, options);
    },
    [i18n, sourceLocale, t],
  );
}

export function useFormatters() {
  const context = useContext(LocaleContext);
  const locale = context?.locale ?? DEFAULT_LOCALE;
  return useMemo(
    () => ({
      formatDate(
        value: Date | number | string,
        options?: Intl.DateTimeFormatOptions,
      ) {
        return new Intl.DateTimeFormat(locale, options).format(
          value instanceof Date ? value : new Date(value),
        );
      },
      formatNumber(value: number, options?: Intl.NumberFormatOptions) {
        return new Intl.NumberFormat(locale, options).format(value);
      },
      formatRelativeTime(
        value: number,
        unit: Intl.RelativeTimeFormatUnit,
        options?: Intl.RelativeTimeFormatOptions,
      ) {
        return new Intl.RelativeTimeFormat(locale, options).format(value, unit);
      },
      formatList(value: string[], options?: Intl.ListFormatOptions) {
        return new Intl.ListFormat(locale, options).format(value);
      },
    }),
    [locale],
  );
}

export function LanguagePicker({
  className,
  includeSystem = true,
  label,
  variant = "select",
}: {
  className?: string;
  includeSystem?: boolean;
  label?: string;
  variant?: "select" | "icon";
}) {
  const { locale, preference, setPreference } = useLocale();
  const [open, setOpen] = useState(false);
  const copy =
    LANGUAGE_PICKER_COPY[locale] ?? LANGUAGE_PICKER_COPY[DEFAULT_LOCALE];
  const resolvedLabel = label ?? copy.label;
  const options = [
    ...(includeSystem
      ? [
          {
            value: "system" as const,
            label: copy.system,
            description: copy.systemDescription,
          },
        ]
      : []),
    ...SUPPORTED_LOCALES.map((code) => ({
      value: code,
      label: `${LOCALE_METADATA[code].nativeName} (${code})`,
      description: code,
    })),
  ];
  const selected = options.find((option) => option.value === preference);
  const selectedLabel = selected?.label ?? preference;
  const triggerLabel = `${resolvedLabel}: ${selectedLabel}`;

  function handleOptionClick(value: LocalePreference) {
    setOpen(false);
    void setPreference(normalizeLocalizationPreference(value).locale);
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
              "shrink-0 rounded-md border border-border bg-background text-foreground outline-none transition-colors hover:border-foreground/30 hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:border-foreground/30 data-[state=open]:bg-accent/40",
              variant === "icon"
                ? "flex h-8 w-8 items-center justify-center"
                : "flex h-9 w-full items-center justify-between gap-2 px-3 text-start text-sm",
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
            align={variant === "icon" ? "end" : "start"}
            sideOffset={6}
            role="menu"
            className={cn(
              "z-[9999] max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none will-change-[transform,opacity] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:duration-100 data-[state=open]:duration-150 data-[state=closed]:ease-in data-[state=open]:ease-out data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
              variant === "icon"
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
