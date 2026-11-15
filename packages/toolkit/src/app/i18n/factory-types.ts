import type {
  AgentNativeI18nCatalog,
  AgentNativeI18nLocaleLoader,
  LocaleCode,
  LocaleMessages,
} from "@agent-native/core/client/i18n";

export type ToolkitCreateI18nCatalogArgs = Omit<
  AgentNativeI18nCatalog,
  "messages" | "loadMessages" | "sourceLocale"
> & {
  messages: LocaleMessages;
  sourceLocale?: LocaleCode;
  loadMessages?: AgentNativeI18nCatalog["loadMessages"];
  localeLoaders?: Partial<Record<LocaleCode, AgentNativeI18nLocaleLoader>>;
};

export type ToolkitI18nCatalog = AgentNativeI18nCatalog & {
  messages: LocaleMessages;
  sourceLocale: LocaleCode;
  loadMessages: (locale: LocaleCode) => Promise<LocaleMessages | null>;
};
