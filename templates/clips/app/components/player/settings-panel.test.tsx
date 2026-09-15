// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPanel } from "./settings-panel";

const mocks = vi.hoisted(() => ({
  createCta: vi.fn(),
  toastError: vi.fn(),
  createOutcome: "success" as "success" | "error",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const ReactModule = await import("react");
  return {
    actionErrorMessage: (error: Error) => error.message,
    useReconciledState: <T,>(value: T) => ReactModule.useState(value),
    useActionMutation: (
      name: string,
      options?: {
        onSuccess?: () => void;
        onError?: (error: Error) => void;
      },
    ) => ({
      isPending: false,
      mutate: (payload: unknown) => {
        if (name !== "create-cta") return;
        mocks.createCta(payload);
        if (mocks.createOutcome === "success") options?.onSuccess?.();
        else options?.onError?.(new Error("Create failed"));
      },
    }),
  };
});

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
}

describe("SettingsPanel CTA draft", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.createOutcome = "success";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <SettingsPanel
          recording={{
            id: "recording_1",
            enableComments: true,
            enableReactions: true,
            enableDownloads: true,
            defaultSpeed: "1",
            animatedThumbnailEnabled: true,
          }}
          ctas={[]}
          onClose={vi.fn()}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function openDraft() {
    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "playerSettings.addCta",
    );
    act(() => addButton?.click());
  }

  it("explains invalid URLs and enables Save only for a web address", () => {
    openDraft();
    const url = container.querySelector<HTMLInputElement>('input[type="url"]');
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "common.save",
    );

    expect(url).not.toBeNull();
    expect(save?.disabled).toBe(true);
    act(() => setInputValue(url!, "not a url"));
    expect(url?.getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("playerSettings.validWebUrl");
    expect(save?.disabled).toBe(true);

    act(() => setInputValue(url!, "https://example.com/learn"));
    expect(url?.getAttribute("aria-invalid")).toBe("false");
    expect(save?.disabled).toBe(false);
  });

  it("closes after a successful create and keeps the draft after an error", () => {
    openDraft();
    let url = container.querySelector<HTMLInputElement>('input[type="url"]');
    act(() => setInputValue(url!, "https://example.com/learn"));
    let save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "common.save",
    );
    act(() => save?.click());

    expect(mocks.createCta).toHaveBeenCalledWith({
      recordingId: "recording_1",
      label: "playerSettings.defaultCtaLabel",
      url: "https://example.com/learn",
      placement: "throughout",
    });
    expect(container.querySelector('input[type="url"]')).toBeNull();

    mocks.createOutcome = "error";
    openDraft();
    url = container.querySelector<HTMLInputElement>('input[type="url"]');
    act(() => setInputValue(url!, "https://example.com/retry"));
    save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "common.save",
    );
    act(() => save?.click());

    expect(container.querySelector('input[type="url"]')).not.toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith("Create failed");
  });
});
