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

import {
  coreMessagesForLocale,
  englishAgentChatMessages,
  loadCoreMessagesForLocale,
  normalizeCoreMessageOverrides,
} from "../localization/core-messages.js";
import defaultEnglishMessages from "../localization/default-messages.js";
import {
  DEFAULT_LOCALE,
  LOCALE_HYDRATION_GLOBAL,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  isValidLocaleCode,
  localeDirection,
  localeMetadataFor,
  normalizeLocaleCode,
  normalizeLocalizationPreference,
  resolveLocaleFromCandidates,
  resolveLocaleFromPreference,
  type LocaleCode,
  type LocaleMetadata,
  type LocaleMetadataMap,
  type LocalePreference,
  type LocalizationPreference,
} from "../localization/shared.js";
import { injectedAgentNativeConfig } from "./app-config.js";
import { setClientAppState } from "./application-state.js";
import { callAction } from "./use-action.js";
import { useSession } from "./use-session.js";

export {
  DEFAULT_LOCALE,
  LOCALE_HYDRATION_GLOBAL,
  LOCALE_METADATA,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  isLocaleCode,
  isValidLocaleCode,
  localeDirection,
  localeMetadataFor,
  type BuiltinLocaleCode,
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
export { LanguagePicker } from "./LanguagePicker.js";

export type LocaleMessages = Record<string, unknown>;

export type AgentNativeI18nLocaleLoader = () => Promise<
  LocaleMessages | { default: LocaleMessages }
>;

function isAgentNativeI18nModuleNamespace(
  value: LocaleMessages | { default: LocaleMessages },
): value is { default: LocaleMessages } {
  return Object.prototype.toString.call(value) === "[object Module]";
}

async function loadAgentNativeI18nLocale(
  loader: AgentNativeI18nLocaleLoader | undefined,
): Promise<LocaleMessages | null> {
  if (!loader) return null;
  const loaded = await loader();
  return isAgentNativeI18nModuleNamespace(loaded) ? loaded.default : loaded;
}

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
  /** Metadata for app-registered locales shown in the language picker. */
  locales?: readonly LocaleMetadata[];
  /** Optional partial framework translations for app-registered locales. */
  coreMessageOverrides?: Partial<
    Record<LocaleCode, AgentNativeI18nLocaleLoader>
  >;
  /**
   * Locales this app actually ships translations for. Defaults to every
   * framework-supported locale when omitted, which only matches apps whose
   * `loadMessages` covers all of them.
   */
  supportedLocales?: readonly LocaleCode[];
}

export function createAgentNativeI18nCatalog(args: {
  messages: LocaleMessages;
  localeLoaders: Partial<Record<LocaleCode, AgentNativeI18nLocaleLoader>>;
  locales?: readonly LocaleMetadata[];
  coreMessageOverrides?: Partial<
    Record<LocaleCode, AgentNativeI18nLocaleLoader>
  >;
  namespace?: string;
  sourceLocale?: LocaleCode;
  supportedLocales?: readonly LocaleCode[];
}): AgentNativeI18nCatalog & {
  messages: LocaleMessages;
  sourceLocale: LocaleCode;
  loadMessages: (locale: LocaleCode) => Promise<LocaleMessages | null>;
} {
  return {
    namespace: args.namespace,
    sourceLocale: args.sourceLocale ?? DEFAULT_LOCALE,
    messages: args.messages,
    locales: args.locales,
    coreMessageOverrides: args.coreMessageOverrides,
    supportedLocales: args.supportedLocales,
    loadMessages: async (locale) => {
      return loadAgentNativeI18nLocale(args.localeLoaders[locale]);
    },
  };
}

export interface AgentNativeI18nProviderProps {
  children: React.ReactNode;
  catalog?: AgentNativeI18nCatalog;
  initialLocale?: LocaleCode;
  initialPreference?: LocalizationPreference | LocalePreference;
  initialMessages?: LocaleMessages | null;
  persistPreference?: boolean;
}

function catalogLocaleMetadata(
  locales: readonly LocaleMetadata[] | undefined,
): LocaleMetadataMap {
  return Object.fromEntries(
    (locales ?? []).flatMap((metadata) => {
      if (!isValidLocaleCode(metadata.code)) return [];
      const code = normalizeLocaleCode(metadata.code, [metadata.code]);
      return code ? [[code, { ...metadata, code }] as const] : [];
    }),
  );
}

interface LocaleContextValue {
  locale: LocaleCode;
  sourceLocale: LocaleCode;
  preference: LocalePreference;
  dir: "ltr" | "rtl";
  metadata: LocaleMetadata;
  localeMetadata: LocaleMetadataMap;
  setPreference: (preference: LocalePreference) => Promise<void>;
  loading: boolean;
  supportedLocales: readonly LocaleCode[];
}

declare global {
  var __AGENT_NATIVE_LOCALE_CONTEXT__:
    | React.Context<LocaleContextValue | null>
    | undefined;
  interface Window {
    __AGENT_NATIVE_LOCALE__?: LocaleHydrationPayload;
  }
}

const LocaleContext =
  globalThis.__AGENT_NATIVE_LOCALE_CONTEXT__ ??
  (globalThis.__AGENT_NATIVE_LOCALE_CONTEXT__ =
    createContext<LocaleContextValue | null>(null));

function browserLanguageCandidates(): string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length
    ? [...navigator.languages]
    : navigator.language
      ? [navigator.language]
      : [];
}

function readStoredPreference(
  supportedLocales?: readonly LocaleCode[],
): LocalePreference | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeLocalizationPreference(
      window.localStorage.getItem(LOCALE_STORAGE_KEY),
      supportedLocales,
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
  sourceLocale: LocaleCode;
  supportedLocales: readonly LocaleCode[];
}): { locale: LocaleCode; preference: LocalePreference } {
  const hydration = readHydrationPayload();
  const preference = normalizeLocalizationPreference(
    args.initialPreference ??
      hydration.preference ??
      readStoredPreference(args.supportedLocales),
    args.supportedLocales,
  ).locale;
  const requestedLocale =
    args.initialLocale ??
    hydration.locale ??
    resolveLocaleFromPreference(
      preference,
      browserLanguageCandidates(),
      args.supportedLocales,
    );
  const locale =
    normalizeLocaleCode(requestedLocale, args.supportedLocales) ??
    args.sourceLocale;
  return { locale, preference };
}

function resolveSupportedLocales(args: {
  catalog?: AgentNativeI18nCatalog;
  sourceLocale: LocaleCode;
}): readonly LocaleCode[] {
  const configured = injectedAgentNativeConfig().translations?.locales;
  const catalogLocales = args.catalog?.locales?.map(({ code }) => code) ?? [];
  const candidates = configured ?? [
    ...(args.catalog?.supportedLocales ?? SUPPORTED_LOCALES),
    ...catalogLocales,
  ];
  const sourceCandidates = [...candidates, args.sourceLocale];
  const supported = sourceCandidates
    .map((locale) => normalizeLocaleCode(locale, sourceCandidates))
    .filter((locale): locale is LocaleCode => locale !== null);
  const sourceLocale =
    normalizeLocaleCode(args.sourceLocale, sourceCandidates) ?? DEFAULT_LOCALE;
  return [
    sourceLocale,
    ...supported.filter((locale) => locale !== sourceLocale),
  ].filter((locale, index, all) => all.indexOf(locale) === index);
}

function resolveSupportedLocale(
  locale: LocaleCode,
  supportedLocales: readonly LocaleCode[],
  sourceLocale: LocaleCode,
): LocaleCode {
  return supportedLocales.includes(locale) ? locale : sourceLocale;
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

function mergeLocaleMessages(
  base: LocaleMessages,
  overrides?: LocaleMessages | null,
): LocaleMessages {
  if (!overrides) return base;
  const merged: LocaleMessages = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = merged[key];
    if (
      current &&
      value &&
      typeof current === "object" &&
      typeof value === "object" &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      merged[key] = mergeLocaleMessages(
        current as LocaleMessages,
        value as LocaleMessages,
      );
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function composeLocaleMessages(
  coreMessages: LocaleMessages,
  appMessages?: LocaleMessages | null,
): LocaleMessages {
  return mergeLocaleMessages(
    mergeLocaleMessages(defaultEnglishMessages, coreMessages),
    appMessages ? normalizeCoreMessageOverrides(appMessages) : null,
  );
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
      [args.namespace]: composeLocaleMessages(
        coreMessagesForLocale(args.sourceLocale),
        args.messages,
      ),
    },
  };
  if (args.initialLocale !== args.sourceLocale) {
    resources[args.initialLocale] = {
      [args.namespace]: composeLocaleMessages(
        coreMessagesForLocale(args.initialLocale),
        args.initialMessages,
      ),
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

/**
 * Runtime half of the i18n provider. `sessionAuthenticated` only matters when
 * `persistPreference` is true: the preference read and the app-state write
 * are authenticated server calls, so a signed-out visitor skips them instead
 * of logging 401 console errors on every load.
 */
function I18nRuntime({
  children,
  catalog,
  initialLocale,
  initialPreference,
  initialMessages,
  persistPreference = true,
  sessionAuthenticated,
}: AgentNativeI18nProviderProps & { sessionAuthenticated: boolean }) {
  const namespace = catalog?.namespace ?? "translation";
  const sourceLocale = catalog?.sourceLocale ?? DEFAULT_LOCALE;
  const sourceMessages = catalog?.messages ?? {};
  const loadMessages = catalog?.loadMessages;
  const coreMessageOverrides = catalog?.coreMessageOverrides;
  const localeMetadata = useMemo(
    () => catalogLocaleMetadata(catalog?.locales),
    [catalog?.locales],
  );
  const supportedLocales = useMemo(
    () => resolveSupportedLocales({ catalog, sourceLocale }),
    [catalog, sourceLocale],
  );
  const hydration = readHydrationPayload();
  const initialState = useMemo(
    () =>
      resolveInitialState({
        initialLocale,
        initialPreference,
        sourceLocale,
        supportedLocales,
      }),
    [initialLocale, initialPreference, sourceLocale, supportedLocales],
  );
  const [preference, setPreferenceState] = useState<LocalePreference>(
    initialState.preference,
  );
  const [locale, setLocale] = useState<LocaleCode>(initialState.locale);
  const [loading, setLoading] = useState(false);
  const i18nRef = useRef<I18nInstance | null>(null);
  const appMessagesLoadedRef = useRef<Set<LocaleCode> | null>(null);
  const appMessagesRef = useRef<Map<LocaleCode, LocaleMessages> | null>(null);
  const coreMessagesLoadedRef = useRef<Set<LocaleCode> | null>(null);

  if (!i18nRef.current) {
    const preloadedMessages = normalizeLoadedMessages(
      hydration.locale === initialState.locale && hydration.messages
        ? hydration.messages
        : initialMessages,
    );
    const resolvedSourceMessages = normalizeCoreMessageOverrides(
      hydration.locale === sourceLocale && hydration.messages
        ? hydration.messages
        : sourceMessages,
    );
    i18nRef.current = createI18nInstance({
      namespace,
      sourceLocale,
      messages: resolvedSourceMessages,
      initialLocale: initialState.locale,
      initialMessages: preloadedMessages,
    });
    appMessagesRef.current = new Map([[sourceLocale, resolvedSourceMessages]]);
    appMessagesLoadedRef.current = new Set([sourceLocale]);
    if (initialState.locale !== sourceLocale && preloadedMessages) {
      appMessagesRef.current.set(
        initialState.locale,
        normalizeCoreMessageOverrides(preloadedMessages),
      );
      appMessagesLoadedRef.current.add(initialState.locale);
    }
    coreMessagesLoadedRef.current = new Set(
      [sourceLocale, initialState.locale].filter(
        (candidate) => candidate === DEFAULT_LOCALE,
      ),
    );
  }

  const i18n = i18nRef.current;

  useEffect(() => {
    if (i18n.hasResourceBundle(sourceLocale, namespace)) {
      const normalizedSourceMessages =
        normalizeCoreMessageOverrides(sourceMessages);
      appMessagesRef.current?.set(sourceLocale, normalizedSourceMessages);
      i18n.addResourceBundle(
        sourceLocale,
        namespace,
        normalizedSourceMessages,
        true,
        true,
      );
    }
  }, [i18n, namespace, sourceLocale, sourceMessages]);

  useEffect(() => {
    const nextLocale =
      preference === "system"
        ? resolveLocaleFromCandidates(
            browserLanguageCandidates(),
            supportedLocales,
          )
        : preference;
    setLocale(
      resolveSupportedLocale(nextLocale, supportedLocales, sourceLocale),
    );
  }, [preference, sourceLocale, supportedLocales]);

  useEffect(() => {
    let cancelled = false;

    async function applyLocale() {
      setLoading(true);
      try {
        const shouldLoadAppMessages =
          locale !== sourceLocale && !appMessagesLoadedRef.current?.has(locale);
        const shouldLoadCoreMessages =
          !coreMessagesLoadedRef.current?.has(locale);

        if (shouldLoadAppMessages || shouldLoadCoreMessages) {
          const preloaded =
            hydration.locale === locale && hydration.messages
              ? hydration.messages
              : initialLocale === locale && initialMessages
                ? initialMessages
                : null;
          const [coreMessages, loadedAppMessages, loadedCoreOverrides] =
            await Promise.all([
              shouldLoadCoreMessages
                ? loadCoreMessagesForLocale(locale)
                : Promise.resolve<LocaleMessages>({}),
              shouldLoadAppMessages
                ? Promise.resolve(preloaded ?? loadMessages?.(locale))
                : Promise.resolve(null),
              shouldLoadCoreMessages
                ? loadAgentNativeI18nLocale(coreMessageOverrides?.[locale])
                : Promise.resolve(null),
            ]);
          const existingMessages = normalizeLoadedMessages(
            i18n.getResourceBundle(locale, namespace),
          );
          const loadedMessages = normalizeLoadedMessages(loadedAppMessages);
          if (loadedMessages) {
            appMessagesRef.current?.set(
              locale,
              normalizeCoreMessageOverrides(loadedMessages),
            );
          }
          const appMessages = appMessagesRef.current?.get(locale) ?? null;
          const resolvedCoreMessages = mergeLocaleMessages(
            coreMessages,
            loadedCoreOverrides
              ? normalizeCoreMessageOverrides(loadedCoreOverrides)
              : null,
          );
          const nextMessages = shouldLoadCoreMessages
            ? composeLocaleMessages(resolvedCoreMessages, appMessages)
            : mergeLocaleMessages(existingMessages ?? {}, appMessages);
          i18n.addResourceBundle(locale, namespace, nextMessages, true, true);
          if (shouldLoadCoreMessages) {
            coreMessagesLoadedRef.current?.add(locale);
          }
          if (shouldLoadAppMessages) {
            appMessagesLoadedRef.current?.add(locale);
          }
        }
        if (!cancelled) {
          await i18n.changeLanguage(locale);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(
            `[agent-native] Failed to load ${locale} messages; falling back to ${sourceLocale}`,
            error,
          );
          setLocale(sourceLocale);
          await i18n.changeLanguage(sourceLocale).catch((fallbackError) => {
            console.error(
              `[agent-native] Failed to switch to source locale ${sourceLocale}`,
              fallbackError,
            );
          });
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
    coreMessageOverrides,
    loadMessages,
    localeMetadata,
    locale,
    namespace,
    sourceLocale,
    supportedLocales,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const dir = localeDirection(locale, localeMetadata);
    const root = document.documentElement;
    root.setAttribute("lang", locale);
    root.setAttribute("dir", dir);
    root.setAttribute("data-locale", locale);
  }, [locale, localeMetadata]);

  useEffect(() => {
    if (!persistPreference || !sessionAuthenticated) return;
    let cancelled = false;
    callAction<LocalizationPreference>(
      "get-localization-preference",
      undefined,
      { method: "GET" },
    )
      .then((value) => {
        if (cancelled) return;
        const normalized = normalizeLocalizationPreference(
          value,
          supportedLocales,
        ).locale;
        setPreferenceState(normalized);
        writeStoredPreference(normalized);
      })
      .catch(() => {
        // Anonymous/public routes use localStorage/browser language only.
      });
    return () => {
      cancelled = true;
    };
  }, [persistPreference, sessionAuthenticated, supportedLocales]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY || event.newValue == null) return;
      setPreferenceState(
        normalizeLocalizationPreference(event.newValue, supportedLocales)
          .locale,
      );
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [supportedLocales]);

  useEffect(() => {
    if (!persistPreference || !sessionAuthenticated) return;
    void setClientAppState(
      "localization",
      {
        locale,
        preference,
        dir: localeDirection(locale, localeMetadata),
      },
      { requestSource: "localization" },
    ).catch(() => {
      // Public/anonymous pages cannot write app-state; localization still works.
    });
  }, [
    locale,
    localeMetadata,
    persistPreference,
    preference,
    sessionAuthenticated,
  ]);

  const setPreference = useCallback(
    async (next: LocalePreference) => {
      const normalized = normalizeLocalizationPreference(
        next,
        supportedLocales,
      ).locale;
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
    [persistPreference, supportedLocales],
  );

  const context = useMemo<LocaleContextValue>(
    () => ({
      locale,
      sourceLocale,
      preference,
      dir: localeDirection(locale, localeMetadata),
      metadata: localeMetadataFor(locale, localeMetadata),
      localeMetadata,
      setPreference,
      loading,
      supportedLocales,
    }),
    [
      loading,
      locale,
      preference,
      setPreference,
      sourceLocale,
      supportedLocales,
      localeMetadata,
    ],
  );

  return (
    <LocaleContext.Provider value={context}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}

/**
 * Session-aware variant: only mounts the session hook (and therefore only
 * ever resolves the shared session) on surfaces that persist preferences.
 * AppProviders defaults public paths to the non-persisting variant, so a
 * public page never resolves the session for localization; a persisting
 * surface pays one deduped session probe and skips the preference read and
 * app-state write until the session confirms, which is what keeps anonymous
 * visits free of localization 401s.
 */
function SessionAwareI18nRuntime(
  props: Omit<AgentNativeI18nProviderProps, "persistPreference"> & {
    persistPreference: true;
  },
) {
  const { status } = useSession();
  return (
    <I18nRuntime {...props} sessionAuthenticated={status === "authenticated"} />
  );
}

export function AgentNativeI18nProvider(props: AgentNativeI18nProviderProps) {
  if (props.persistPreference === false) {
    return <I18nRuntime {...props} sessionAuthenticated />;
  }
  return <SessionAwareI18nRuntime {...props} persistPreference />;
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
  ...Object.fromEntries(
    Object.entries(englishAgentChatMessages).map(([key, value]) => [
      `agentChat.${key}`,
      value,
    ]),
  ),
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
  "runsTray.statusNeedsApproval": "Needs approval",
  "runsTray.statusNeedsInput": "Needs input",
  "runsTray.statusPaused": "Paused",
  "runsTray.updatedJustNow": "Updated just now",
  "runsTray.finishedJustNow": "Finished just now",
  "runsTray.updatedMinutes": "Updated {{count}}m ago",
  "runsTray.finishedMinutes": "Finished {{count}}m ago",
  "runsTray.updatedHours": "Updated {{count}}h ago",
  "runsTray.finishedHours": "Finished {{count}}h ago",
  "runsTray.updatedDate": "Updated {{date}}",
  "runsTray.finishedDate": "Finished {{date}}",
  "agentTask.spawnedAgent": "Spawned agent",
  "agentTask.stop": "Stop spawned agent",
  "agentTask.openThread": "Open task thread",
  "codeRequired.fallbackDetail":
    "Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like.",
  "codeRequired.defaultFeature": "Make the requested code changes to this app",
  "codeRequired.branchError": "Failed to create branch",
  "codeRequired.title": "Code changes required",
  "codeRequired.subtitleWithFeature":
    '"{{feature}}" creates or modifies source code, which needs Desktop or Builder from this surface.',
  "codeRequired.subtitle":
    "This action creates or modifies source code, which needs Desktop or Builder from this surface.",
  "codeRequired.desktopTitle": "Use Agent-Native Desktop",
  "codeRequired.desktopDescription":
    "Open the project in the desktop app to enable source edits and CLI access.",
  "codeRequired.builderAgentTitle": "Use Builder.io Agent",
  "codeRequired.builderAgentDescription":
    "Let our cloud agent make the changes for you. You'll get a link to preview and deploy.",
  "codeRequired.codeChangeTitle": "This requires a code change",
  "codeRequired.codeChangeBadge": "Code change",
  "codeRequired.connectBuilderTitle": "Connect Builder.io",
  "codeRequired.connectBuilderDescription":
    "Connect Builder (free tier available) to enable cloud-based code changes from this app.",
  "codeRequired.setupRequired": "Setup required",
  "codeRequired.branchCreated": "Branch created",
  "codeRequired.close": "Close",
  "agentPanel.useBuilder": "Use Builder",
  "agentPanel.openDesktopToEditCode": "Open Desktop to edit code",
  "agentPanel.codeUnavailableDescription":
    "Source-code changes and CLI access are available in the Agent-Native Desktop app.",
  "agentPanel.downloadDesktop": "Download Desktop",
  "agentPanel.chatMode": "Chat mode",
  "agentPanel.chat": "Chat",
  "agentPanel.cliTerminalMode": "CLI terminal mode",
  "agentPanel.cli": "CLI",
  "agentPanel.workspaceMode": "Files, agents, skills, and tasks",
  "agentPanel.workspace": "Resources",
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
  "runtimeConfig.warningTitle": "Production configuration warning",
  "runtimeConfig.errorTitle": "Production configuration error",
  "runtimeConfig.issue_one": "{{count}} issue",
  "runtimeConfig.issue_other": "{{count}} issues",
  "runtimeConfig.showDetails": "Show configuration details",
  "runtimeConfig.hideDetails": "Hide configuration details",
  "runtimeConfig.copyPrompt": "Copy prompt for AI",
  "runtimeConfig.copied": "Prompt copied",
  "runtimeConfig.copyFailed": "Copy failed",
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

function preserveTranslatedUserValues(
  translated: string,
  options?: Record<string, unknown>,
) {
  const defaultValue = options?.defaultValue;
  return typeof defaultValue === "string" && translated === defaultValue
    ? interpolateFallbackMessage(defaultValue, options)
    : translated;
}

export function useT() {
  const { i18n, t } = useTranslation();
  const context = useContext(LocaleContext);
  const sourceLocale = context?.sourceLocale ?? DEFAULT_LOCALE;
  return useCallback(
    (key: string, options?: Record<string, unknown>) => {
      const translated = t(key, options);
      if (translated !== key)
        return preserveTranslatedUserValues(translated, options);
      const getFixedT = (
        i18n as { getFixedT?: (locale: LocaleCode) => typeof t }
      ).getFixedT;
      const sourceFallback = getFixedT?.(sourceLocale)(key, options);
      if (sourceFallback && sourceFallback !== key)
        return preserveTranslatedUserValues(sourceFallback, options);
      return fallbackMessage(key, options);
    },
    [i18n, sourceLocale, t],
  );
}

export function useIconPickerLabels() {
  const t = useT();
  return {
    allCategories: t("iconPicker.allCategories"),
    loadError: t("iconPicker.loadError"),
    saveError: t("iconPicker.saveError"),
    uploadTooLarge: t("iconPicker.uploadTooLarge"),
    retry: t("iconPicker.retry"),
    uploadHint: t("iconPicker.uploadHint"),
    colorNames: Object.fromEntries(
      Object.keys(defaultEnglishMessages.iconPicker.colorNames).map((color) => [
        color,
        t(`iconPicker.colorNames.${color}`),
      ]),
    ),
    categoryNames: Object.fromEntries(
      Object.keys(defaultEnglishMessages.iconPicker.categoryNames).map(
        (category) => [category, t(`iconPicker.categoryNames.${category}`)],
      ),
    ),
    groupNames: Object.fromEntries(
      Object.keys(defaultEnglishMessages.iconPicker.groupNames).map((group) => [
        group,
        t(`iconPicker.groupNames.${group}`),
      ]),
    ),
  };
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
