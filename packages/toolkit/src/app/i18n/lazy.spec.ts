import { SUPPORTED_LOCALES } from "@agent-native/core/client/i18n";
import { describe, expect, it } from "vitest";

import { createToolkitI18nCatalog, toolkitMessagesForLocale } from "../i18n.js";
import { TOOLKIT_LOCALES } from "./catalog.js";
import { createLazyToolkitI18nCatalog } from "./lazy.js";
import { loadToolkitLocaleMessages } from "./locale-loaders.js";
import { mergeMessages } from "./merge.js";

const NON_SOURCE = [
  ...new Set([...TOOLKIT_LOCALES, ...SUPPORTED_LOCALES]),
].filter((locale) => locale !== "en-US");

describe("lazy Toolkit locales", () => {
  it("retains the English fallback when Core adds a locale before Toolkit", async () => {
    expect(await loadToolkitLocaleMessages("it-IT")).toEqual(
      toolkitMessagesForLocale("it-IT"),
    );
  });
  it("keeps the default factory (flag off) on the synchronous aggregate", () => {
    const catalog = createToolkitI18nCatalog({
      sourceLocale: "es-ES",
      messages: { app: { greeting: "hola" } },
    });
    expect(catalog.sourceLocale).toBe("es-ES");
    expect(catalog.messages).toEqual(
      mergeMessages(toolkitMessagesForLocale("es-ES"), {
        app: { greeting: "hola" },
      }),
    );
  });

  it("matches the synchronous source merge for the optimized English source", () => {
    const messages = { app: { greeting: "hello" } };
    const oldCatalog = createToolkitI18nCatalog({ messages });
    const lazyCatalog = createLazyToolkitI18nCatalog({ messages });
    expect(lazyCatalog.messages).toEqual(oldCatalog.messages);
    expect(lazyCatalog.sourceLocale).toBe("en-US");
  });

  it("matches every lazy non-English load to the synchronous aggregate plus app override", async () => {
    for (const locale of NON_SOURCE) {
      const appOverride = { app: { [locale]: `override-${locale}` } };
      const localeLoaders = { [locale]: async () => appOverride };
      const oldCatalog = createToolkitI18nCatalog({
        messages: {},
        localeLoaders,
      });
      const lazyCatalog = createLazyToolkitI18nCatalog({
        messages: {},
        localeLoaders,
      });
      expect(await lazyCatalog.loadMessages(locale)).toEqual(
        await oldCatalog.loadMessages(locale),
      );
      expect(await lazyCatalog.loadMessages(locale)).toEqual(
        mergeMessages(toolkitMessagesForLocale(locale), appOverride),
      );
    }
  });

  it("rejects a non-English sourceLocale with a clear config error", () => {
    expect(() =>
      createLazyToolkitI18nCatalog({ sourceLocale: "es-ES", messages: {} }),
    ).toThrow(/en-US/);
    expect(() =>
      createLazyToolkitI18nCatalog({ sourceLocale: "de-DE", messages: {} }),
    ).toThrow(/sourceLocale/);
  });

  it("preserves app-loader over custom-loader precedence and unknown locales", async () => {
    const customLoadMessages = async (locale: string) => ({ custom: locale });
    const appLoader = async () => ({ app: true });
    const localeLoaders = { "es-ES": appLoader };
    const args = {
      messages: {},
      loadMessages: customLoadMessages,
      localeLoaders,
    };
    const oldCatalog = createToolkitI18nCatalog(args);
    const lazyCatalog = createLazyToolkitI18nCatalog(args);

    expect(await lazyCatalog.loadMessages("es-ES")).toEqual(
      await oldCatalog.loadMessages("es-ES"),
    );
    expect(await lazyCatalog.loadMessages("es-ES")).toEqual(
      mergeMessages(toolkitMessagesForLocale("es-ES"), { app: true }),
    );
    expect(await lazyCatalog.loadMessages("fr-FR")).toEqual(
      await oldCatalog.loadMessages("fr-FR"),
    );
    expect(await lazyCatalog.loadMessages("fr-FR")).toEqual(
      mergeMessages(toolkitMessagesForLocale("fr-FR"), { custom: "fr-FR" }),
    );
    expect(await lazyCatalog.loadMessages("xx-XX")).toBeNull();
    expect(await oldCatalog.loadMessages("xx-XX")).toBeNull();
  });
});
