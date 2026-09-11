// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDefaultModelField } from "./SettingsPanel.js";

const BUILDER_MODELS = [
  "auto",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "gpt-5-6-sol",
  "gpt-5-6-terra",
  "gpt-5-6-luna",
  "gemini-3-1-pro",
  "gemini-3-5-flash",
];

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
          value="gpt-5-6-sol"
          onValueChange={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[role="combobox"][aria-label="Model"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain("GPT-5.6 Sol");
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
      "Opus 4.8",
      "Sonnet 5",
      "Haiku 4.5",
      "GPT-5.6 Sol",
      "GPT-5.6 Terra",
      "GPT-5.6 Luna",
      "Gemini 3.1 Pro",
      "Gemini 3.5 Flash",
    ]);
  });

  it("keeps custom provider model ids editable", () => {
    const onValueChange = vi.fn();
    act(() => {
      root.render(
        <AppDefaultModelField
          engine="ai-sdk:openrouter"
          models={["z-ai/glm-5.2"]}
          value="custom/provider-model"
          onValueChange={onValueChange}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input[list]");
    expect(input?.value).toBe("custom/provider-model");

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
