// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentNativeI18nProvider,
  LanguagePicker,
  LOCALE_STORAGE_KEY,
} from "./i18n.js";

describe("LanguagePicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
});
