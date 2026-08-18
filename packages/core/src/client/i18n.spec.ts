import { describe, expect, it } from "vitest";

import { createAgentNativeI18nCatalog } from "./i18n.js";

describe("createAgentNativeI18nCatalog", () => {
  it("loads local module defaults and returns null for unsupported locales", async () => {
    const messages = { greeting: "Hello" };
    const moduleMessages = Object.defineProperty(
      { default: { greeting: "Hola" } },
      Symbol.toStringTag,
      { value: "Module" },
    );
    const catalog = createAgentNativeI18nCatalog({
      messages,
      localeLoaders: {
        "es-ES": async () => moduleMessages,
      },
    });

    expect(catalog.sourceLocale).toBe("en-US");
    expect(catalog.messages).toBe(messages);
    await expect(catalog.loadMessages?.("es-ES")).resolves.toEqual({
      greeting: "Hola",
    });
    await expect(catalog.loadMessages?.("fr-FR")).resolves.toBeNull();
  });

  it("preserves direct loader results and catalog options", async () => {
    const messages = { greeting: "Hello" };
    const catalog = createAgentNativeI18nCatalog({
      messages,
      localeLoaders: {
        "es-ES": async () => ({ greeting: "Hola" }),
      },
      namespace: "app",
      sourceLocale: "es-ES",
      supportedLocales: ["es-ES"],
    });

    expect(catalog.namespace).toBe("app");
    expect(catalog.sourceLocale).toBe("es-ES");
    expect(catalog.supportedLocales).toEqual(["es-ES"]);
    await expect(catalog.loadMessages?.("es-ES")).resolves.toEqual({
      greeting: "Hola",
    });
  });

  it("preserves a direct message object with a top-level default key", async () => {
    const messages = { greeting: "Hello" };
    const directMessages = { default: { greeting: "Default" } };
    const catalog = createAgentNativeI18nCatalog({
      messages,
      localeLoaders: {
        "es-ES": async () => directMessages,
      },
    });

    await expect(catalog.loadMessages?.("es-ES")).resolves.toBe(directMessages);
  });
});
