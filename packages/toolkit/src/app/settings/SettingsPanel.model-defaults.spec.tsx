// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDefaultModelField, friendlyModelName } from "./SettingsPanel.js";

const BUILDER_MODELS = [
  "auto",
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "gpt-6-1-sol",
  "gpt-5-6-terra",
  "gpt-6-luna",
  "gemini-3-1-pro",
  "gemini-3-8-flash",
  "gemini-3-5-flash-lite",
  "gemini-3-1-flash-lite",
];

describe("friendlyModelName", () => {
  it("keeps custom model ids safe and formats dated Claude ids", () => {
    expect(friendlyModelName("toString")).toBe("toString");
    expect(friendlyModelName("claude-haiku-4-20251001")).toBe("Haiku 4");
    expect(friendlyModelName("claude-fable-5-1")).toBe("Fable 5.1");
  });
});

describe("AppDefaultModelField", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("uses a full select for Builder instead of a filtered native datalist", () => {
    act(() => {
      root.render(
        <AppDefaultModelField
          engine="builder"
          models={BUILDER_MODELS}
          value="gpt-6-1-sol"
          onValueChange={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[role="combobox"][aria-label="Model"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain("GPT-6.1 Sol");
    expect(container.querySelector("input[list]")).toBeNull();

    act(() => {
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });

    const options = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
      (option) => option.textContent?.trim(),
    );
    expect(options).toEqual([
      "auto",
      "Haiku 5.5",
      "Sonnet 5.5",
      "Opus 5.5",
      "GPT-6.1 Sol",
      "GPT-5.6 Terra",
      "GPT-6 Luna",
      "Gemini 3.1 Pro",
      "Gemini 3.8 Flash",
      "Gemini 3.5 Flash Lite",
      "Gemini 3.1 Flash Lite",
    ]);
  });

  it("keeps custom provider model ids editable", () => {
    const onValueChange = vi.fn();
    act(() => {
      root.render(
        <AppDefaultModelField
          engine="ai-sdk:openrouter"
          models={[
            "z-ai/glm-5.2",
            "gpt-6-sol",
            "openai/gpt-6-luna",
            "anthropic/claude-opus-5.5",
            "anthropic/claude-opus-4.8",
          ]}
          value="custom/provider-model"
          onValueChange={onValueChange}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input[list]");
    expect(input?.value).toBe("custom/provider-model");
    expect(
      Array.from(
        container.querySelectorAll<HTMLOptionElement>("datalist option"),
        (option) => option.getAttribute("label"),
      ),
    ).toEqual(["GLM 5.2", "GPT-6 Sol", "GPT-6 Luna", "Opus 5.5"]);

    act(() => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "another/custom-model");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onValueChange).toHaveBeenCalledWith("another/custom-model");
  });
});
