// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptComposer } from "./PromptComposer.js";
import {
  ComposerRuntimeAdaptersProvider,
  type ComposerAgentEngineState,
} from "./runtime-adapters.js";

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
  vi.unstubAllGlobals();
});

function SetupCard({ bouncePulse }: { bouncePulse?: number }) {
  return <div data-testid="setup-card" data-bounce={bouncePulse ?? 0} />;
}

async function render({
  readiness,
  configured,
  otherProviderConfigured = false,
  onModelConnectionRequiredChange,
}: {
  readiness: ComposerAgentEngineState;
  configured: boolean;
  otherProviderConfigured?: boolean;
  onModelConnectionRequiredChange?: (required: boolean) => void;
}) {
  await act(async () => {
    root.render(
      <ComposerRuntimeAdaptersProvider
        adapters={{
          models: {
            useAgentEngineConfigured: () => ({
              missing: readiness === "missing",
              state: readiness,
            }),
            BuilderSetupCard: SetupCard,
          },
        }}
      >
        <PromptComposer
          autoFocus={false}
          onSubmit={vi.fn()}
          requireAgentEngine
          modelStatusChecksEnabled={false}
          availableModels={[
            {
              engine: "anthropic",
              label: "Anthropic",
              models: ["example-model"],
              configured,
            },
            ...(otherProviderConfigured
              ? [
                  {
                    engine: "openai",
                    label: "OpenAI",
                    models: ["other-model"],
                    configured: true,
                  },
                ]
              : []),
          ]}
          selectedModel="example-model"
          selectedEngine="anthropic"
          onModelChange={vi.fn()}
          onModelConnectionRequiredChange={onModelConnectionRequiredChange}
          includeDefaultMentionSearch={false}
          includeDefaultSlashSkills={false}
          voiceEnabled={false}
        />
      </ComposerRuntimeAdaptersProvider>,
    );
  });
}

const card = () =>
  container.querySelector<HTMLElement>('[data-testid="setup-card"]');
const editor = () => container.querySelector<HTMLElement>(".ProseMirror");

describe("PromptComposer with no AI connected", () => {
  it("shows the setup card and closes the prompt before readiness answers", async () => {
    const onRequired = vi.fn();
    await render({
      readiness: "unknown",
      configured: false,
      onModelConnectionRequiredChange: onRequired,
    });

    expect(card()).not.toBeNull();
    expect(editor()?.getAttribute("contenteditable")).toBe("false");
    expect(onRequired).toHaveBeenLastCalledWith(true);
  });

  it("points a click on the closed prompt at the setup card", async () => {
    await render({ readiness: "unknown", configured: false });

    await act(async () => {
      editor()!.click();
    });

    expect(card()?.dataset.bounce).toBe("1");
  });

  it("keeps the prompt open once readiness says AI is configured", async () => {
    await render({ readiness: "configured", configured: false });

    expect(card()).toBeNull();
    expect(editor()?.getAttribute("contenteditable")).toBe("true");
  });

  it("keeps the prompt open when only the selected model's provider is unconnected", async () => {
    const onRequired = vi.fn();
    await render({
      readiness: "unknown",
      configured: false,
      otherProviderConfigured: true,
      onModelConnectionRequiredChange: onRequired,
    });

    expect(card()).toBeNull();
    expect(editor()?.getAttribute("contenteditable")).toBe("true");
    expect(onRequired).not.toHaveBeenCalledWith(true);
  });

  it("keeps the prompt open while the model list has a connected provider", async () => {
    await render({ readiness: "unknown", configured: true });

    expect(card()).toBeNull();
    expect(editor()?.getAttribute("contenteditable")).toBe("true");
  });
});
