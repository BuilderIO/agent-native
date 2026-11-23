// @vitest-environment happy-dom
// Row 592 (content-2): the reference composer labels its default model "Auto". The host passes
// `defaultModel="auto"`; the trigger must read "Auto" while the concrete model stays an option, and
// a host that passes nothing must keep the server's default.
// Mutants that fail this: dropping `defaultModel` from the resolution (trigger then reads the
// adapter's model), or putting `defaultModel` ahead of `selectedModel` (a user pick stops winning).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptComposer } from "./PromptComposer.js";
import { ComposerRuntimeAdaptersProvider } from "./runtime-adapters.js";

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

const groups = [
  {
    engine: "openai",
    label: "OpenAI",
    models: ["auto", "gpt-6-luna"],
    configured: true,
  },
];

async function render({
  defaultModel,
  selectedModel,
}: {
  defaultModel?: string;
  selectedModel?: string;
}) {
  await act(async () => {
    root.render(
      <ComposerRuntimeAdaptersProvider
        adapters={{
          models: {
            useChatModels: () => ({
              selectedModel: "gpt-6-luna",
              selectedEngine: "openai",
              selectedEffort: "high" as const,
              availableModels: groups,
              isLoading: false,
              onModelChange: vi.fn(),
              onEffortChange: vi.fn(),
            }),
            useAgentEngineConfigured: () => ({
              missing: false,
              state: "configured" as const,
            }),
            fetchAgentEngineConfiguredState: async () => "configured" as const,
          },
        }}
      >
        <PromptComposer
          autoFocus={false}
          onSubmit={vi.fn()}
          modelStatusChecksEnabled={false}
          availableModels={groups}
          defaultModel={defaultModel}
          selectedModel={selectedModel}
          onModelChange={vi.fn()}
          includeDefaultSlashSkills={false}
          voiceEnabled={false}
        />
      </ComposerRuntimeAdaptersProvider>,
    );
  });
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-agent-composer-slot="model-button"]',
  );
  return trigger;
}

describe("composer default model label", () => {
  it("reads Auto when the host defaults to auto", async () => {
    const trigger = await render({ defaultModel: "auto" });
    expect(trigger?.textContent).toContain("Auto");
  });

  it("keeps the adapter's model when the host passes no default", async () => {
    const trigger = await render({});
    expect(trigger?.textContent).toContain("Luna");
  });

  it("lets an explicit selection win over the host default", async () => {
    const trigger = await render({
      defaultModel: "auto",
      selectedModel: "gpt-6-luna",
    });
    expect(trigger?.textContent).toContain("Luna");
    expect(trigger?.textContent).not.toContain("Auto");
  });
});
