// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { docsI18nCatalog } from "../i18n";
import { SlidesTryNow } from "./SlidesTryNow";

afterEach(() => {
  cleanup();
});

describe("SlidesTryNow", () => {
  it("extracts only selected dropdown values rather than all option texts", () => {
    render(
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <SlidesTryNow />
      </AgentNativeI18nProvider>,
    );

    const submitLink = screen.getByRole("link", { name: "Generate my deck" });
    fireEvent.click(submitLink);

    const href = submitLink.getAttribute("href") || "";
    const url = new URL(href);
    const initialPrompt = url.searchParams.get("initialPrompt") || "";

    expect(initialPrompt).toContain("B2B sales pitch");
    expect(initialPrompt).toContain("brief");
    expect(initialPrompt).not.toContain("capital raise");
    expect(initialPrompt).not.toContain("offering memorandum");
    expect(initialPrompt).not.toContain("minimal");
    expect(initialPrompt).not.toContain("thorough");
  });

  it("associates the visible prompt label with the editable textbox", () => {
    render(
      <AgentNativeI18nProvider
        catalog={docsI18nCatalog}
        initialLocale="en-US"
        initialPreference="en-US"
        persistPreference={false}
      >
        <SlidesTryNow />
      </AgentNativeI18nProvider>,
    );

    const prompt = screen.getByRole("textbox", { name: "Your prompt" });
    const labelId = prompt.getAttribute("aria-labelledby");

    expect(labelId).toBe("slides-try-now-prompt-label");
    expect(document.getElementById(labelId || "")?.textContent).toBe(
      "Your prompt",
    );
    expect(prompt.getAttribute("contenteditable")).toBe("true");
  });
});
