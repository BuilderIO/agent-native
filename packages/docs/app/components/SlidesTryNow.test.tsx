// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { type ReactNode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { docsI18nCatalog } from "../i18n";
import {
  PROMPT_DELETE_INTERVAL_MS,
  PROMPT_HOLD_MS,
  PROMPT_TYPE_INTERVAL_MS,
  SLIDES_TRY_NOW_PROMPTS,
  SlidesTryNow,
} from "./SlidesTryNow";

function slidesTryNowElement() {
  return (
    <AgentNativeI18nProvider
      catalog={docsI18nCatalog}
      initialLocale="en-US"
      initialPreference="en-US"
      persistPreference={false}
    >
      <SlidesTryNow />
    </AgentNativeI18nProvider>
  );
}

function renderSlidesTryNow() {
  return render(slidesTryNowElement());
}

function PreEffectPromptEdit({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const prompt = document.querySelector<HTMLElement>(
      "#slides-try-now-prompt",
    );
    if (!prompt) return;

    prompt.innerHTML = "Typed before<br>hydration";
    prompt.focus();
  }, []);

  return children;
}

function advanceTimersByTime(milliseconds: number) {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("SlidesTryNow", () => {
  it("types the first prompt and keeps the Generate href in sync", () => {
    renderSlidesTryNow();

    const promptBox = screen.getByRole("textbox", {
      name: "Presentation generation prompt",
    });
    const submitLink = screen.getByRole("link", { name: "Generate my deck" });

    expect(promptBox.textContent).toBe("");

    advanceTimersByTime(PROMPT_TYPE_INTERVAL_MS * 5);

    const visiblePrompt = SLIDES_TRY_NOW_PROMPTS[0].slice(0, 5);
    expect(promptBox.textContent).toBe(visiblePrompt);
    expect(submitLink.getAttribute("href")).toBe(
      `https://slides.agent-native.com/?initialPrompt=${encodeURIComponent(visiblePrompt)}`,
    );
  });

  it("holds for two seconds, deletes, and advances to the next prompt", () => {
    renderSlidesTryNow();

    const promptBox = screen.getByRole("textbox", {
      name: "Presentation generation prompt",
    });
    const firstPrompt = SLIDES_TRY_NOW_PROMPTS[0];

    advanceTimersByTime(PROMPT_TYPE_INTERVAL_MS * firstPrompt.length);
    expect(promptBox.textContent).toBe(firstPrompt);

    advanceTimersByTime(PROMPT_HOLD_MS - 1);
    expect(promptBox.textContent).toBe(firstPrompt);

    advanceTimersByTime(1);
    expect(promptBox.textContent).toBe(firstPrompt.slice(0, -1));

    advanceTimersByTime(PROMPT_DELETE_INTERVAL_MS * (firstPrompt.length - 1));
    expect(promptBox.textContent).toBe("");

    advanceTimersByTime(PROMPT_TYPE_INTERVAL_MS);
    expect(promptBox.textContent).toBe(SLIDES_TRY_NOW_PROMPTS[1][0]);
  });

  it("stops permanently on interaction without overwriting user edits", () => {
    renderSlidesTryNow();

    const promptBox = screen.getByRole("textbox", {
      name: "Presentation generation prompt",
    });
    const submitLink = screen.getByRole("link", { name: "Generate my deck" });

    advanceTimersByTime(PROMPT_TYPE_INTERVAL_MS * 8);
    const stoppedText = promptBox.textContent;
    fireEvent.pointerDown(promptBox);
    advanceTimersByTime(30_000);
    expect(promptBox.textContent).toBe(stoppedText);

    promptBox.innerHTML = "Customer roadmap<br>For enterprise teams";
    fireEvent.input(promptBox);
    advanceTimersByTime(30_000);

    expect(promptBox.textContent).toBe("Customer roadmapFor enterprise teams");
    expect(submitLink.getAttribute("href")).toBe(
      "https://slides.agent-native.com/?initialPrompt=Customer%20roadmap%0AFor%20enterprise%20teams",
    );
  });

  it("preserves and syncs prompt text present before its effect runs", () => {
    render(<PreEffectPromptEdit>{slidesTryNowElement()}</PreEffectPromptEdit>);

    const promptBox = screen.getByRole("textbox", {
      name: "Presentation generation prompt",
    });
    const submitLink = screen.getByRole("link", { name: "Generate my deck" });

    expect(promptBox.innerHTML).toBe("Typed before<br>hydration");
    expect(submitLink.getAttribute("href")).toBe(
      "https://slides.agent-native.com/?initialPrompt=Typed%20before%0Ahydration",
    );

    advanceTimersByTime(30_000);
    expect(promptBox.innerHTML).toBe("Typed before<br>hydration");
  });

  it("shows a stable full prompt when reduced motion is preferred", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
    } as MediaQueryList);

    renderSlidesTryNow();

    const promptBox = screen.getByRole("textbox", {
      name: "Presentation generation prompt",
    });
    expect(promptBox.textContent).toBe(SLIDES_TRY_NOW_PROMPTS[0]);

    advanceTimersByTime(30_000);
    expect(promptBox.textContent).toBe(SLIDES_TRY_NOW_PROMPTS[0]);
  });

  it("associates the visible prompt label with the editable textbox", () => {
    renderSlidesTryNow();

    const prompt = screen.getByRole("textbox", {
      name: "Presentation generation prompt",
    });
    const labelId = prompt.getAttribute("aria-labelledby");

    expect(labelId).toBe("slides-try-now-prompt-label");
    expect(document.getElementById(labelId || "")?.textContent).toBe(
      "Presentation generation prompt",
    );
    expect(prompt.getAttribute("data-placeholder")).toBeNull();
    expect(prompt.getAttribute("contenteditable")).toBe("true");
  });

  it("renders tooltip next to the presentation generation prompt", () => {
    renderSlidesTryNow();

    expect(screen.getByRole("tooltip").textContent).toContain(
      "Be specific. Generic prompts = generic decks.",
    );
  });
});
