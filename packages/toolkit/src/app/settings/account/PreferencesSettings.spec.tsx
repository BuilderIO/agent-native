// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const localeState = vi.hoisted(() => ({ value: {} as object | null }));
const sessionState = vi.hoisted(() => ({
  value: {
    session: null as { email?: string } | null,
    status: "loading" as "loading" | "authenticated" | "unauthenticated",
  },
}));
const appConfigState = vi.hoisted(() => ({
  value: {
    themeFamily: {
      families: ["original", "agent-native"],
      defaultFamily: "agent-native",
    },
  } as object,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useOptionalLocale: () => localeState.value,
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => sessionState.value,
}));
vi.mock("@agent-native/core/client/app-config", () => ({
  injectedAgentNativeConfig: () => appConfigState.value,
}));
vi.mock("../../shared/index.js", () => ({
  LanguagePicker: ({ label }: { label?: string }) => (
    <button type="button" data-testid="language-picker">
      {label}
    </button>
  ),
}));
vi.mock("../SchedulingTimezoneField.js", () => ({
  SchedulingTimezoneField: () => <div data-testid="timezone-field" />,
}));
vi.mock("../VoiceTranscriptionSection.js", () => ({
  VoiceTranscriptionSection: ({ compact }: { compact?: boolean }) => (
    <div data-testid="voice" data-compact={String(!!compact)} />
  ),
}));
// Its rows have their own spec; here it only needs its anchored group.
vi.mock("../VoiceChatSettings.js", () => ({
  VoiceChatSettings: () => (
    <section id="voice-chat">
      <h2>Voice chat</h2>
    </section>
  ),
}));
vi.mock("./ThemeFamilySettings.js", () => ({
  ThemeFamilySettings: () => <div data-testid="theme-family-settings" />,
}));

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";

import { createToolkitI18nCatalog } from "../../i18n.js";
import { PreferencesSettings } from "./PreferencesSettings.js";
import { PREFERENCES_SEARCH_ENTRIES } from "./search-entries.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

describe("PreferencesSettings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localeState.value = {};
    sessionState.value = {
      session: { email: "steve@builder.io" },
      status: "authenticated",
    };
    appConfigState.value = {
      themeFamily: {
        families: ["original", "agent-native"],
        defaultFamily: "agent-native",
      },
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitI18nCatalog}
          persistPreference={false}
        >
          <PreferencesSettings />
        </AgentNativeI18nProvider>,
      );
    });
  }

  it("groups language and timezone, then voice input and voice chat", async () => {
    await render();
    const groups = [...container.querySelectorAll("section")];
    expect(groups.map((group) => group.id)).toEqual([
      "language-region",
      "appearance",
      "voice-input",
      "voice-chat",
    ]);
    expect(groups[0]!.querySelector("h2")?.textContent).toBe(
      "Language and region",
    );
    expect(groups[1]!.querySelector("h2")?.textContent).toBe("Appearance");
    expect(groups[2]!.querySelector("h2")?.textContent).toBe("Voice input");
    expect(groups[3]!.querySelector("h2")?.textContent).toBe("Voice chat");

    const language = container.querySelector("#interface-language");
    expect(language?.textContent).toContain("Interface language");
    expect(language?.textContent).toContain("Applies on all your devices.");
    expect(
      language?.querySelector('[data-testid="language-picker"]'),
    ).not.toBeNull();

    const timezone = container.querySelector("#timezone");
    expect(timezone?.textContent).toContain("Timezone");
    expect(timezone?.textContent).toContain(
      "Used for timestamps and scheduled automations.",
    );

    const themeFamily = container.querySelector("#theme-family");
    expect(themeFamily?.textContent).toContain("Theme family");
    expect(
      themeFamily?.querySelector('[data-testid="theme-family-settings"]'),
    ).not.toBeNull();

    expect(
      groups[2]!
        .querySelector('[data-testid="voice"]')
        ?.getAttribute("data-compact"),
    ).toBe("true");
  });

  it("leaves out the language row when the app has no locale provider", async () => {
    localeState.value = null;
    await render();
    expect(container.querySelector("#interface-language")).toBeNull();
    expect(container.querySelector("#timezone")).not.toBeNull();
  });

  it("never renders the theme switch during server rendering", () => {
    const html = renderToString(
      <AgentNativeI18nProvider
        catalog={toolkitI18nCatalog}
        persistPreference={false}
      >
        <PreferencesSettings />
      </AgentNativeI18nProvider>,
    );

    expect(html).not.toContain('id="theme-family"');
  });

  it("never shows the theme switch to a non-Builder account", async () => {
    sessionState.value = {
      session: { email: "person@example.com" },
      status: "authenticated",
    };
    await render();

    expect(container.querySelector("#theme-family")).toBeNull();
  });

  it("hides the theme switch when an app declares only its original family", async () => {
    appConfigState.value = {
      themeFamily: { families: ["original"], defaultFamily: "original" },
    };
    await render();

    expect(container.querySelector("#theme-family")).toBeNull();
  });

  it("keeps the theme switch hidden until the signed-in session is loaded", async () => {
    sessionState.value = {
      session: null,
      status: "loading",
    };
    await render();

    expect(container.querySelector("#theme-family")).toBeNull();
  });

  it("anchors every Preferences search entry to a row", async () => {
    await render();
    for (const entry of PREFERENCES_SEARCH_ENTRIES) {
      // Voice's row is rendered by VoiceTranscriptionSection (its own spec).
      if (entry.anchor === "voice") continue;
      expect(container.querySelector(`#${entry.anchor}`), entry.id).not.toBe(
        null,
      );
    }
  });
});
