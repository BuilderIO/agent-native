// @vitest-environment happy-dom

import { ToolkitProvider } from "@agent-native/toolkit";
import type { PickerProps } from "@agent-native/toolkit/design-system";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentNativeI18nProvider,
  LanguagePicker,
  LOCALE_STORAGE_KEY,
  useT,
} from "./i18n.js";

function CoreChatTranslationProbe() {
  const t = useT();
  return <span>{t("agentChat.status.thinking")}</span>;
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

function importI18nCopy(tag: string) {
  const specifier = `./i18n.js?${tag}`;
  return import(/* @vite-ignore */ specifier) as Promise<
    typeof import("./i18n.js")
  >;
}

describe("LanguagePicker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localStorageDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
    vi.unstubAllGlobals();
  });

  async function renderPicker(variant: "select" | "icon" = "select") {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
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

  async function waitForContainerText(expected: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (container.textContent === expected) return;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    expect(container.textContent).toBe(expected);
  }

  it("renders the app picker as a polished popover instead of a combobox menu", async () => {
    await renderPicker();

    const trigger = document.querySelector("[data-language-picker-trigger]");
    expect(trigger?.tagName).toBe("BUTTON");
    expect(trigger?.getAttribute("role")).not.toBe("combobox");
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Interface language: English (en-US)",
    );

    await click(trigger!);

    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.body.textContent).toContain("System");
    expect(document.body.textContent).toContain("Français (fr-FR)");
    expect(document.body.textContent).toContain("العربية (ar-SA)");
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
      "English (en-US)",
      "Español (es-ES)",
      "Français (fr-FR)",
      "Deutsch (de-DE)",
      "Português (Brasil) (pt-BR)",
      "简体中文 (zh-CN)",
      "繁體中文 (zh-TW)",
      "日本語 (ja-JP)",
      "한국어 (ko-KR)",
      "हिन्दी (hi-IN)",
      "العربية (ar-SA)",
    ]);
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
    ).toBe("Interface language: Français (fr-FR)");
  });

  it("shares locale context across duplicate optimized module instances", async () => {
    const providerModule = await importI18nCopy("provider-copy");
    const consumerModule = await importI18nCopy("consumer-copy");
    const Provider = providerModule.AgentNativeI18nProvider;
    const ForeignLanguagePicker = consumerModule.LanguagePicker;

    await act(async () => {
      root.render(
        <Provider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ForeignLanguagePicker label="Interface language" />
        </Provider>,
      );
      await Promise.resolve();
    });

    expect(
      document
        .querySelector("[data-language-picker-trigger]")
        ?.getAttribute("aria-label"),
    ).toBe("Interface language: English (en-US)");
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

  it("provides localized Core chat copy without requiring an app catalog", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
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

  it("lets an app catalog override built-in Core chat copy", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
          initialMessages={{
            agentChat: { status: { thinking: "App denkt nach" } },
          }}
        >
          <CoreChatTranslationProbe />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toBe("App denkt nach");
  });

  it("loads the app catalog for an initial non-source locale before rendering overrides", async () => {
    const requestedLocales: string[] = [];

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={{
            sourceLocale: "en-US",
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
          }}
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <CoreChatTranslationProbe />
        </AgentNativeI18nProvider>,
      );
    });

    await waitForContainerText("App denkt nach");
    expect(requestedLocales).toEqual(["de-DE"]);
  });

  it("uses locale plural rules for built-in count-bearing chat copy", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
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

  it("applies RTL direction when Arabic Core chat copy is active", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
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
