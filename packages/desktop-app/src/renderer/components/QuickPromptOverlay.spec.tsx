// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/chat/composer/index", () => ({
  PromptComposer: ({
    disabled,
    selectedModel,
  }: {
    disabled: boolean;
    selectedModel: string;
  }) => (
    <textarea
      aria-label="composer"
      disabled={disabled}
      data-model={selectedModel}
    />
  ),
  readAgentPromptAttachment: vi.fn(),
}));
vi.mock("@agent-native/toolkit/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import QuickPromptOverlay from "./QuickPromptOverlay.js";

let container: HTMLDivElement;
let root: Root;
const model = {
  engine: "openai",
  engineLabel: "OpenAI",
  model: "gpt-5",
  configured: true,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Quick Prompt model discovery", () => {
  it("retries an unavailable catalog and restores the composer", async () => {
    const listModels = vi
      .fn()
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({
        status: "ok",
        models: [model],
        selected: model,
      });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        codeAgents: {
          listModels,
          listProjects: vi.fn(async () => ({ projects: [] })),
        },
        quickPrompt: {
          setSetupRequired: vi.fn(),
          onHidden: () => () => {},
          setPickerOpen: vi.fn(),
        },
      },
    });
    await act(async () => {
      root.render(
        <QuickPromptOverlay onSubmit={vi.fn()} onDismiss={vi.fn()} />,
      );
    });
    const composer = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const retry = () =>
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "common.retry",
      )!;
    expect(composer.disabled).toBe(true);
    expect(retry()).toBeDefined();
    await act(async () => retry().click());
    expect(composer.disabled).toBe(true);
    expect(retry()).toBeDefined();
    await act(async () => retry().click());
    expect(listModels).toHaveBeenLastCalledWith({ refresh: true });
    expect(composer.disabled).toBe(false);
    expect(retry()).toBeUndefined();
  });

  it("keeps a persisted configured choice on the initial catalog load", async () => {
    const chosen = { ...model, model: "gpt-5-mini" };
    localStorage.setItem(
      "agent-native-code:model-selection",
      JSON.stringify(chosen),
    );
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        codeAgents: {
          listModels: vi.fn(async () => ({
            status: "ok",
            models: [model, chosen],
            selected: model,
          })),
          listProjects: vi.fn(async () => ({ projects: [] })),
        },
        quickPrompt: {
          setSetupRequired: vi.fn(),
          onHidden: () => () => {},
          setPickerOpen: vi.fn(),
        },
      },
    });
    await act(async () => {
      root.render(
        <QuickPromptOverlay onSubmit={vi.fn()} onDismiss={vi.fn()} />,
      );
    });
    expect(
      container.querySelector("textarea")?.getAttribute("data-model"),
    ).toBe("gpt-5-mini");
  });

  it.each([
    ["retry", "rejection"],
    ["retry", "unavailable"],
    ["focus", "rejection"],
    ["focus", "unavailable"],
  ])(
    "ignores an older %s %s after a newer successful refresh",
    async (older, outcome) => {
      let rejectOlder: (error: Error) => void = () => {};
      let resolveOlder: (result: { status: string }) => void = () => {};
      const listModels = vi
        .fn()
        .mockResolvedValueOnce({ status: "unavailable" })
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              resolveOlder = resolve;
              rejectOlder = reject;
            }),
        )
        .mockResolvedValueOnce({
          status: "ok",
          models: [model],
          selected: model,
        });
      Object.defineProperty(window, "electronAPI", {
        configurable: true,
        value: {
          codeAgents: {
            listModels,
            listProjects: vi.fn(async () => ({ projects: [] })),
          },
          quickPrompt: {
            setSetupRequired: vi.fn(),
            onHidden: () => () => {},
            setPickerOpen: vi.fn(),
          },
        },
      });
      await act(async () => {
        root.render(
          <QuickPromptOverlay onSubmit={vi.fn()} onDismiss={vi.fn()} />,
        );
      });
      const retry = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "common.retry",
      )!;
      await act(async () => {
        if (older === "retry") retry.click();
        else window.dispatchEvent(new Event("focus"));
      });
      await act(async () => {
        if (older === "retry") window.dispatchEvent(new Event("focus"));
        else retry.click();
      });
      const composer =
        container.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(composer.disabled).toBe(false);
      await act(async () => {
        if (outcome === "rejection") rejectOlder(new Error("late failure"));
        else resolveOlder({ status: "unavailable" });
      });
      expect(composer.disabled).toBe(false);
      expect(container.textContent).not.toContain(
        "setup.providerStatusUnavailable",
      );
    },
  );
});
