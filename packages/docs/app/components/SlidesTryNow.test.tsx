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
  it("encodes typed prompt text into the initialPrompt URL parameter", () => {
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

    const promptBox = screen.getByRole("textbox", { name: "Your prompt" });
    promptBox.textContent = "A quarterly review deck for board members";

    const submitLink = screen.getByRole("link", { name: "Generate my deck" });
    fireEvent.click(submitLink);

    const href = submitLink.getAttribute("href") || "";
    const url = new URL(href);
    const initialPrompt = url.searchParams.get("initialPrompt") || "";

    expect(initialPrompt).toBe("A quarterly review deck for board members");
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

  it("renders tooltip next to Your prompt", () => {
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

    expect(screen.getByRole("tooltip").textContent).toContain(
      "Be specific. Generic prompts = generic decks.",
    );
  });
});
