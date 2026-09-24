import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AgentNativeI18nProvider,
  createAgentNativeI18nCatalog,
  useT,
} from "./i18n.js";

function EnvironmentBadgeProbe() {
  const t = useT();
  return React.createElement(
    "span",
    null,
    t("environmentBadge.betaTitle", { label: "Beta" }),
  );
}

describe("createAgentNativeI18nCatalog", () => {
  it("renders the selected locale's environment badge on the first pass", () => {
    const catalog = createAgentNativeI18nCatalog({
      messages: {},
      localeLoaders: {},
      supportedLocales: ["en-US", "es-ES"],
    });

    const html = renderToString(
      React.createElement(
        AgentNativeI18nProvider,
        {
          catalog,
          initialLocale: "es-ES",
          initialPreference: "es-ES",
          persistPreference: false,
        },
        React.createElement(EnvironmentBadgeProbe),
      ),
    );

    expect(html).toContain("Estás en Agent-Native Beta");
  });

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
      locales: [
        {
          code: "it-IT",
          nativeName: "Italiano",
          englishName: "Italian",
          dir: "ltr",
        },
      ],
      coreMessageOverrides: {
        "it-IT": async () => ({ settings: { title: "Impostazioni" } }),
      },
      supportedLocales: ["es-ES"],
    });

    expect(catalog.namespace).toBe("app");
    expect(catalog.sourceLocale).toBe("es-ES");
    expect(catalog.supportedLocales).toEqual(["es-ES"]);
    expect(catalog.locales?.[0]?.nativeName).toBe("Italiano");
    const coreOverrideLoader = catalog.coreMessageOverrides?.["it-IT"];
    expect(coreOverrideLoader).toBeDefined();
    await expect(coreOverrideLoader!()).resolves.toEqual({
      settings: { title: "Impostazioni" },
    });
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
