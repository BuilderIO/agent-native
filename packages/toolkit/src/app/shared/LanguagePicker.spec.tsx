// @vitest-environment happy-dom

import {
  AgentNativeI18nProvider,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  useLocale,
  useT,
} from "@agent-native/core/client/i18n";
import { ToolkitProvider } from "@agent-native/toolkit";
import type { PickerProps } from "@agent-native/toolkit/design-system";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { LanguagePicker } from "./LanguagePicker.js";

function toolkitCatalog() {
  return createToolkitI18nCatalog({ messages: {} });
}

function CoreChatTranslationProbe() {
  const t = useT();
  return <span>{t("agentChat.status.thinking")}</span>;
}

function ToolkitCatalogProbe() {
  const t = useT();
  return (
    <span>
      {t("agentChat.status.thinking")} | {t("agentChat.composer.addContext")}
    </span>
  );
}

function CoreChatPluralProbe({ count }: { count: number }) {
  const t = useT();
  return (
    <span>
      {t("agentChat.widget.rows", {
        count,
        formattedCount: count.toLocaleString("de-DE"),
      })}
    </span>
  );
}

function CoreChatInterpolationProbe({ name }: { name: string }) {
  const t = useT();
  return <span>{t("agentChat.composer.removeAttachment", { name })}</span>;
}

function CoreVoiceModeProbe() {
  const t = useT();
  return <span>{t("agentChat.voiceMode.entryButtonLabel")}</span>;
}

function CustomLocaleProbe() {
  const t = useT();
  const { locale, metadata } = useLocale();
  return (
    <span data-custom-locale={locale}>
      {metadata.nativeName}: {t("agentChat.status.thinking")}
    </span>
  );
}

function LocaleBundleFallbackProbe() {
  const t = useT();
  const { loading } = useLocale();
  return <span>{loading ? "loading" : t("agentPanel.settings")}</span>;
}

function importLanguagePickerCopy(tag: string) {
  const specifier = `./LanguagePicker.js?${tag}`;
  return import(/* @vite-ignore */ specifier) as Promise<
    typeof import("./LanguagePicker.js")
  >;
}

describe("LanguagePicker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localStorageDescriptor: PropertyDescriptor | undefined;
  let navigatorLanguagesDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    navigatorLanguagesDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "languages",
    );
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });
    localStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    if (typeof window.localStorage.clear !== "function") {
      const values = new Map<string, string>();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          get length() {
            return values.size;
          },
          clear: () => values.clear(),
          getItem: (key: string) => values.get(key) ?? null,
          key: (index: number) => [...values.keys()][index] ?? null,
          removeItem: (key: string) => values.delete(key),
          setItem: (key: string, value: string) =>
            values.set(String(key), String(value)),
        },
      });
    }
    window.localStorage.clear();
    document.documentElement.lang = "en-US";
    document.documentElement.dir = "ltr";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    window.localStorage.clear();
    if (localStorageDescriptor) {
      Object.defineProperty(window, "localStorage", localStorageDescriptor);
    }
    if (navigatorLanguagesDescriptor) {
      Object.defineProperty(
        window.navigator,
        "languages",
        navigatorLanguagesDescriptor,
      );
    } else {
      delete (window.navigator as { languages?: string[] }).languages;
    }
    vi.unstubAllGlobals();
  });

  async function renderPicker(variant: "select" | "icon" = "select") {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
          catalog={{
            sourceLocale: "en-US",
            supportedLocales: SUPPORTED_LOCALES,
          }}
        >
          <LanguagePicker label="Interface language" variant={variant} />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });
  }

  async function click(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  // Catalogs load through dynamic imports, which take far longer than a few
  // polls when every core is busy, so wait on a deadline, not an attempt count.
  async function waitForContainer(done: () => boolean) {
    const deadline = Date.now() + 5_000;
    while (!done() && Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  }

  async function waitForContainerText(expected: string) {
    await waitForContainer(() => container.textContent === expected);
    expect(container.textContent).toBe(expected);
  }

  it("renders the app picker as a polished popover instead of a combobox menu", async () => {
    await renderPicker();

    const trigger = document.querySelector("[data-language-picker-trigger]");
    expect(trigger?.tagName).toBe("BUTTON");
    expect(trigger?.getAttribute("role")).not.toBe("combobox");
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Interface language: English",
    );

    await click(trigger!);

    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.body.textContent).toContain("System");
    expect(document.body.textContent).toContain("Français");
    expect(document.body.textContent).toContain("العربية");
  });

  it("keeps the locale options in product order", async () => {
    await renderPicker();

    await click(document.querySelector("[data-language-picker-trigger]")!);

    const optionLabels = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ).map((button) => button.textContent?.trim());

    expect(optionLabels).toEqual([
      "System",
      "English",
      "Español",
      "Français",
      "Deutsch",
      "Português",
      "简体中文",
      "繁體中文",
      "日本語",
      "한국어",
      "हिन्दी",
      "العربية",
    ]);
  });

  it("labels System using the browser locale instead of the active UI locale", async () => {
    const languagesDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "languages",
    );
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      value: ["zh-CN"],
    });

    try {
      await renderPicker();
      await click(document.querySelector("[data-language-picker-trigger]")!);

      const optionLabels = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]',
        ),
      ).map((button) => button.textContent?.trim());

      expect(optionLabels[0]).toBe("系统");
    } finally {
      if (languagesDescriptor) {
        Object.defineProperty(
          window.navigator,
          "languages",
          languagesDescriptor,
        );
      } else {
        delete (window.navigator as { languages?: string[] }).languages;
      }
    }
  });

  it("updates the shared locale preference from a popover row", async () => {
    await renderPicker();

    await click(document.querySelector("[data-language-picker-trigger]")!);
    const frenchOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ).find((button) => button.textContent?.includes("Français"));
    expect(frenchOption).toBeTruthy();

    await click(frenchOption!);

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr-FR");
    expect(document.documentElement.lang).toBe("fr-FR");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(
      document
        .querySelector("[data-language-picker-trigger]")
        ?.getAttribute("aria-label"),
    ).toBe("Interface language: Français");
  });

  it("resolves System from the browser after switching away from an explicit locale", async () => {
    await renderPicker();

    await click(document.querySelector("[data-language-picker-trigger]")!);
    const chineseOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ).find((button) => button.textContent?.trim() === "简体中文");
    expect(chineseOption).toBeTruthy();

    await click(chineseOption!);
    expect(document.documentElement.lang).toBe("zh-CN");

    await click(document.querySelector("[data-language-picker-trigger]")!);
    const systemOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ).find((button) => button.textContent?.trim() === "System");
    expect(systemOption).toBeTruthy();

    await click(systemOption!);
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("system");
  });

  it("shares locale context across duplicate optimized module instances", async () => {
    const consumerModule = await importLanguagePickerCopy("consumer-copy");
    const ForeignLanguagePicker = consumerModule.LanguagePicker;

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ForeignLanguagePicker label="Interface language" />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    expect(
      document
        .querySelector("[data-language-picker-trigger]")
        ?.getAttribute("aria-label"),
    ).toBe("Interface language: English");
  });

  it("only lists locales the app catalog declares support for", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
          catalog={{
            sourceLocale: "en-US",
            supportedLocales: ["en-US", "es-ES", "fr-FR"],
          }}
        >
          <LanguagePicker label="Interface language" />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    await click(document.querySelector("[data-language-picker-trigger]")!);

    const optionLabels = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ).map((button) => button.textContent?.trim());

    expect(optionLabels).toEqual(["System", "English", "Español", "Français"]);
  });

  it("registers custom locale metadata and framework overrides", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="it-IT"
          initialPreference="it-IT"
          persistPreference={false}
          catalog={{
            messages: {},
            locales: [
              {
                code: "it-IT",
                nativeName: "Italiano",
                englishName: "Italian",
                dir: "ltr",
              },
            ],
            loadMessages: async () => ({}),
            supportedLocales: ["en-US"],
            coreMessageOverrides: {
              "it-IT": async () => ({
                agentChat: { status: { thinking: "Sta pensando" } },
              }),
            },
          }}
        >
          <LanguagePicker label="Interface language" />
          <CustomLocaleProbe />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainer(
      () => container.textContent?.includes("Sta pensando") ?? false,
    );
    expect(container.textContent).toContain("Sta pensando");
    expect(
      container
        .querySelector("[data-custom-locale]")
        ?.getAttribute("data-custom-locale"),
    ).toBe("it-IT");
    expect(
      document
        .querySelector("[data-language-picker-trigger]")
        ?.getAttribute("aria-label"),
    ).toBe("Interface language: Italiano");

    await click(document.querySelector("[data-language-picker-trigger]")!);
    expect(
      Array.from(
        document.body.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]',
        ),
      ).map((button) => button.textContent?.trim()),
    ).toContain("Italiano");
  });

  it("routes the select variant through a registered picker adapter", async () => {
    const CustomPicker = (props: PickerProps) => (
      <div data-custom-language-picker>{String(props.value)}</div>
    );

    await act(async () => {
      root.render(
        <ToolkitProvider
          designSystem={{ components: { Picker: CustomPicker } }}
        >
          <AgentNativeI18nProvider
            initialLocale="en-US"
            initialPreference="en-US"
            persistPreference={false}
          >
            <LanguagePicker label="Interface language" />
          </AgentNativeI18nProvider>
        </ToolkitProvider>,
      );
      await Promise.resolve();
    });

    expect(
      document.querySelector("[data-custom-language-picker]"),
    ).not.toBeNull();
  });

  it("provides localized Toolkit chat copy through the app catalog", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitCatalog()}
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <CoreChatTranslationProbe />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainerText("Denkt nach");
  });

  it("preserves mustache text inside an interpolated user value", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitCatalog()}
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <CoreChatInterpolationProbe name="{{document}}" />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainerText("{{document}} entfernen");
  });

  it("lets app source messages override Toolkit chat copy", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={createToolkitI18nCatalog({
            messages: {
              agentChat: { status: { thinking: "App is thinking" } },
            },
          })}
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ToolkitCatalogProbe />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toBe("App is thinking | Add context");
  });

  it("keeps the default English framework fallback inside a non-source locale bundle", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitCatalog()}
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <LocaleBundleFallbackProbe />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainerText("Settings");
  });

  it("maps legacy app chat overrides to new keys without overriding explicit new keys", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
          initialMessages={{
            agentPanel: {
              voiceMode: { entryButtonLabel: "Legacy microphone" },
            },
          }}
        >
          <CoreVoiceModeProbe />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainerText("Legacy microphone");

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
          initialMessages={{
            agentPanel: {
              voiceMode: { entryButtonLabel: "Legacy microphone" },
            },
            agentChat: {
              voiceMode: { entryButtonLabel: "New microphone" },
            },
          }}
          key="explicit-modern-override"
        >
          <CoreVoiceModeProbe />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainerText("New microphone");
  });

  it("loads the Toolkit catalog before rendering app overrides", async () => {
    const requestedLocales: string[] = [];

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={createToolkitI18nCatalog({
            messages: {},
            loadMessages: async (locale) => {
              requestedLocales.push(locale);
              return locale === "de-DE"
                ? {
                    agentChat: {
                      status: { thinking: "App denkt nach" },
                    },
                  }
                : null;
            },
          })}
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <ToolkitCatalogProbe />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainerText("App denkt nach | Kontext hinzufügen");
    expect(requestedLocales).toEqual(["de-DE"]);
  });

  it("uses locale plural rules for count-bearing Toolkit chat copy", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitCatalog()}
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <CoreChatPluralProbe count={1} />
        </AgentNativeI18nProvider>,
      );
    });
    await waitForContainerText("1 Zeile");

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitCatalog()}
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <CoreChatPluralProbe count={2} />
        </AgentNativeI18nProvider>,
      );
    });
    await waitForContainerText("2 Zeilen");
  });

  it("applies RTL direction when Arabic Toolkit chat copy is active", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitCatalog()}
          initialLocale="ar-SA"
          initialPreference="ar-SA"
          persistPreference={false}
        >
          <CoreChatTranslationProbe />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainerText("يفكّر");
    expect(document.documentElement.lang).toBe("ar-SA");
    expect(document.documentElement.dir).toBe("rtl");
  });
});
