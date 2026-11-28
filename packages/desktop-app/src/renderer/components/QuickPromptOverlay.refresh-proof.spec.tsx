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
    selectedEngine,
    selectedEffort,
    onBeforeSubmit,
    onSubmit,
  }: {
    disabled: boolean;
    selectedModel: string;
    selectedEngine: string;
    selectedEffort?: string;
    onBeforeSubmit: () => Promise<
      boolean | { model: string; engine: string; effort?: string }
    >;
    onSubmit: (
      text: string,
      files: File[],
      references: unknown[],
      options: object,
    ) => Promise<void>;
  }) => (
    <>
      <textarea
        aria-label="composer"
        disabled={disabled}
        data-model={selectedModel}
      />
      <button
        disabled={disabled}
        onClick={() =>
          void (async () => {
            const verified = await onBeforeSubmit();
            if (verified) {
              await onSubmit(
                "hello",
                [],
                [],
                typeof verified === "object"
                  ? verified
                  : {
                      model: selectedModel,
                      engine: selectedEngine,
                      effort: selectedEffort,
                    },
              );
            }
          })()
        }
      >
        Send
      </button>
    </>
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
  it.each(["ok", "unavailable"])(
    "waits for the forced pre-submit refresh when focus occurs (%s)",
    async (status) => {
      let finishRefresh: (value: unknown) => void = () => {};
      const listModels = vi
        .fn()
        .mockResolvedValueOnce({
          status: "ok",
          models: [model],
          selected: model,
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishRefresh = resolve;
            }),
        );
      const onSubmit = vi.fn(async () => {});
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
          <QuickPromptOverlay onSubmit={onSubmit} onDismiss={vi.fn()} />,
        );
      });
      const send = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Send",
      )!;
      await act(async () => send.click());
      await act(async () => window.dispatchEvent(new Event("focus")));
      expect(listModels).toHaveBeenCalledTimes(2);
      expect(onSubmit).not.toHaveBeenCalled();
      await act(async () =>
        finishRefresh(
          status === "ok"
            ? { status, models: [model], selected: model }
            : { status },
        ),
      );
      expect(onSubmit).toHaveBeenCalledTimes(status === "ok" ? 1 : 0);
      expect(
        container.querySelector<HTMLTextAreaElement>("textarea")!.disabled,
      ).toBe(status !== "ok");
    },
  );
});
