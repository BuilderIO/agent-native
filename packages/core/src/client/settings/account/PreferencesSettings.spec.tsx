// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const localeState = vi.hoisted(() => ({ value: {} as object | null }));

vi.mock("../../i18n.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../i18n.js")>()),
  useOptionalLocale: () => localeState.value,
}));
vi.mock("../../LanguagePicker.js", () => ({
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

import { PreferencesSettings } from "./PreferencesSettings.js";
import { PREFERENCES_SEARCH_ENTRIES } from "./search-entries.js";

describe("PreferencesSettings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localeState.value = {};
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
      root.render(<PreferencesSettings />);
    });
  }

  it("groups language and timezone, then voice input", async () => {
    await render();
    const groups = [...container.querySelectorAll("section")];
    expect(groups.map((group) => group.id)).toEqual([
      "language-region",
      "voice-input",
    ]);
    expect(groups[0]!.querySelector("h2")?.textContent).toBe(
      "Language and region",
    );
    expect(groups[1]!.querySelector("h2")?.textContent).toBe("Voice input");

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

    expect(
      groups[1]!
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
