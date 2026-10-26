// @vitest-environment happy-dom

import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import {
  ComposerRuntimeAdaptersProvider,
  type ComposerModelDescription,
  type ReasoningEffort,
} from "./runtime-adapters.js";
import { TiptapComposer } from "./TiptapComposer.js";

const emptyChatModelAdapter = {
  async *run() {},
};

let container: HTMLDivElement;
let root: Root;
const initialInnerWidth = window.innerWidth;

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
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: initialInnerWidth,
  });
});

const CLAUDE_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const GPT_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

const CATALOG: Record<string, Partial<ComposerModelDescription>> = {
  auto: {
    name: "Auto",
    shortName: "Auto",
    descriptor: "Recommended",
    recommended: true,
    recommendedRank: 0,
  },
  "claude-opus-5-5": {
    name: "Claude Opus 5.5",
    shortName: "Opus 5.5",
    descriptor: "Flagship capability",
    description: "Most capable Claude model for complex work",
    provider: "anthropic",
    ratings: { cost: 5, reasoning: 5, speed: 2 },
    recommended: true,
    recommendedRank: 1,
    contextWindow: 1_000_000,
    providerDefaultEffort: "medium",
  },
  "gpt-6-1-sol": {
    name: "GPT-6.1 Sol",
    shortName: "GPT-6.1 Sol",
    descriptor: "Flagship capability",
    provider: "openai",
    recommended: true,
    recommendedRank: 2,
  },
  "gemini-3-1-pro": {
    name: "Gemini 3.1 Pro",
    shortName: "Gemini 3.1 Pro",
    descriptor: "Flagship capability",
    provider: "google",
    recommended: true,
    recommendedRank: 3,
  },
  "claude-sonnet-5-5": {
    name: "Claude Sonnet 5.5",
    shortName: "Sonnet 5.5",
    descriptor: "Balanced, efficient",
    provider: "anthropic",
    recommended: true,
    recommendedRank: 4,
  },
  "gpt-5-6-terra": {
    name: "GPT-5.6 Terra",
    shortName: "GPT-5.6 Terra",
    provider: "openai",
    recommended: true,
    recommendedRank: 5,
  },
  "claude-haiku-5-5": {
    name: "Claude Haiku 5.5",
    shortName: "Haiku 5.5",
    descriptor: "Fast, lightweight",
    provider: "anthropic",
    recommended: true,
    recommendedRank: 6,
  },
  "gpt-6-luna": {
    name: "GPT-6 Luna",
    shortName: "GPT-6 Luna",
    provider: "openai",
    recommended: true,
    recommendedRank: 7,
  },
  "claude-opus-4-8": {
    name: "Claude Opus 4.8",
    shortName: "Opus 4.8",
    descriptor: "Previous generation",
    provider: "anthropic",
  },
};

function describeModel(
  model: string,
  engine?: string,
): ComposerModelDescription {
  const entry = CATALOG[model];
  const id = model === "auto" ? "gpt-6-luna" : model;
  return {
    modelId: model,
    engine,
    known: entry !== undefined,
    recommended: false,
    efforts: id.startsWith("claude-")
      ? CLAUDE_EFFORTS
      : id.startsWith("gpt-")
        ? GPT_EFFORTS
        : [],
    ...(engine === "builder"
      ? { billing: { kind: "builder-credits" as const } }
      : engine === "anthropic"
        ? { billing: { kind: "provider-key" as const, provider: "Anthropic" } }
        : {}),
    ...(entry?.catalogId === undefined && entry ? { catalogId: model } : {}),
    ...(model.startsWith("my-") ? { contextWindow: 200_000 } : {}),
    ...entry,
  };
}

const BUILDER_MODELS = [
  "auto",
  "gpt-6-luna",
  "gpt-5-6-terra",
  "gpt-6-1-sol",
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-opus-4-8",
  "gemini-3-1-pro",
];

type Groups = NonNullable<
  React.ComponentProps<typeof TiptapComposer>["availableModels"]
>;

const builderGroups: Groups = [
  {
    engine: "builder",
    label: "Builder.io",
    models: BUILDER_MODELS,
    configured: true,
  },
];

function Harness({
  withCatalog = true,
  ...props
}: Partial<React.ComponentProps<typeof TiptapComposer>> & {
  withCatalog?: boolean;
}) {
  const runtime = useLocalRuntime(emptyChatModelAdapter);
  const composer = (
    <TiptapComposer
      availableModels={[
        {
          engine: "openai",
          label: "OpenAI",
          models: ["gpt-5.6-luna"],
          configured: true,
        },
      ]}
      selectedModel="gpt-5.6-luna"
      selectedEngine="openai"
      onModelChange={vi.fn()}
      includeDefaultSlashSkills={false}
      plusMenuMode="hidden"
      providerConnectStatusEnabled={false}
      voiceEnabled={false}
      {...props}
    />
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        {withCatalog ? (
          <ComposerRuntimeAdaptersProvider
            adapters={{ models: { describe: describeModel } }}
          >
            {composer}
          </ComposerRuntimeAdaptersProvider>
        ) : (
          composer
        )}
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

async function openPicker() {
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-agent-composer-slot="model-button"]',
  )!;
  await act(async () => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

function topLevelRows(menu: HTMLElement) {
  return Array.from(
    menu.querySelectorAll<HTMLElement>("[data-agent-composer-model-row]"),
  );
}

function keydown(target: Element, key: string) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

const agents = [
  { id: "default", label: "Default" },
  { id: "codex", label: "Codex", configured: false },
];

describe("TiptapComposer model picker", () => {
  it("shows Auto and four curated models across providers, without group headers", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="claude-sonnet-5-5"
          selectedEngine="builder"
        />,
      ),
    );
    const menu = await openPicker();
    const rows = topLevelRows(menu);
    expect(
      rows.map((row) => row.getAttribute("data-agent-composer-model-row")),
    ).toEqual([
      "auto",
      "claude-opus-5-5",
      "gpt-6-1-sol",
      "gemini-3-1-pro",
      "claude-sonnet-5-5",
    ]);
    expect(rows[1]!.textContent).toBe("Opus 5.5" + "2");
    expect(rows[1]!.textContent).not.toContain("Flagship capability");
    // Auto's badge follows its name inside the label group; only the check
    // and the shortcut sit at the far end.
    const autoLabel = rows[0]!.firstElementChild!;
    expect(autoLabel.firstElementChild?.textContent).toBe("Auto");
    expect(autoLabel.lastElementChild?.textContent).toBe("Recommended");
    expect(
      rows.slice(1).some((row) => row.textContent?.includes("Recommended")),
    ).toBe(false);
    // The current model's check takes its number's place in the one
    // trailing column.
    expect(
      rows.map(
        (row) =>
          row.lastElementChild?.textContent ||
          (row.lastElementChild?.querySelector("svg") ? "check" : ""),
      ),
    ).toEqual(["1", "2", "3", "4", "check"]);
    const selected = rows.filter(
      (row) => row.getAttribute("aria-checked") === "true",
    );
    expect(selected).toEqual([rows[4]]);
    expect(rows[4]!.querySelector("svg")).not.toBeNull();
    expect(menu.querySelector('[role="group"]')).toBeNull();
    expect(menu.textContent).not.toMatch(/OpenAI|Builder\.io|Gemini ·/);
    expect(
      menu.querySelector('[data-agent-composer-model-section="more"]')
        ?.textContent,
    ).toContain("More models");
  });

  it("puts every other connected model under More models", async () => {
    act(() => root.render(<Harness availableModels={builderGroups} />));
    await openPicker();
    await act(async () =>
      document
        .querySelector<HTMLElement>(
          '[data-agent-composer-model-section="more"]',
        )!
        .click(),
    );
    const panel = document.querySelector<HTMLElement>(
      '[data-agent-composer-model-panel="more"]',
    )!;
    expect(
      topLevelRows(panel).map((row) =>
        row.getAttribute("data-agent-composer-model-row"),
      ),
    ).toEqual([
      "gpt-6-luna",
      "gpt-5-6-terra",
      "claude-haiku-5-5",
      "claude-opus-4-8",
    ]);
    expect(panel.textContent).not.toContain("Previous generation");
  });

  it("lists only the connected key's models", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={[
            {
              engine: "anthropic",
              label: "Claude",
              models: [
                "claude-haiku-5-5",
                "claude-sonnet-5-5",
                "claude-opus-5-5",
                "claude-opus-4-8",
                "claude-fable-5",
              ],
              configured: true,
            },
            {
              engine: "ai-sdk:openai",
              label: "OpenAI",
              models: ["gpt-6-luna", "gpt-6-1-sol"],
              configured: false,
            },
          ]}
          selectedModel="claude-sonnet-5-5"
          selectedEngine="anthropic"
        />,
      ),
    );
    const menu = await openPicker();
    expect(
      topLevelRows(menu).map((row) =>
        row.getAttribute("data-agent-composer-model-row"),
      ),
    ).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(menu.textContent).not.toMatch(/GPT|needs API key|Add your own keys/);
    await act(async () =>
      menu
        .querySelector<HTMLElement>(
          '[data-agent-composer-model-section="more"]',
        )!
        .click(),
    );
    const panel = document.querySelector<HTMLElement>(
      '[data-agent-composer-model-panel="more"]',
    )!;
    expect(
      topLevelRows(panel).map((row) =>
        row.getAttribute("data-agent-composer-model-row"),
      ),
    ).toEqual(["claude-opus-4-8", "claude-fable-5"]);
  });

  it("shows a small engine's models in full with no More models", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={[
            {
              engine: "ai-sdk:openai",
              label: "OpenAI",
              models: ["gpt-6-luna", "my-fine-tune", "gpt-6-1-sol"],
              configured: true,
            },
          ]}
          selectedModel="gpt-6-luna"
          selectedEngine="ai-sdk:openai"
        />,
      ),
    );
    const menu = await openPicker();
    expect(
      topLevelRows(menu).map((row) =>
        row.getAttribute("data-agent-composer-model-row"),
      ),
    ).toEqual(["gpt-6-luna", "my-fine-tune", "gpt-6-1-sol"]);
    expect(
      menu.querySelector('[data-agent-composer-model-section="more"]'),
    ).toBeNull();
  });

  it("shows a custom model on a connected key by name only", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={[
            {
              engine: "ai-sdk:openai",
              label: "OpenAI",
              models: ["my-fine-tune"],
              configured: true,
            },
          ]}
          selectedModel="my-fine-tune"
          selectedEngine="ai-sdk:openai"
        />,
      ),
    );
    const menu = await openPicker();
    const [row] = topLevelRows(menu);
    expect(row!.textContent).toBe("my-fine-tune");
    expect(row!.querySelector(".agent-kit-caption-copy")).toBeNull();
    await act(async () => row!.focus());
    const card = document.querySelector<HTMLElement>(
      "[data-agent-composer-model-card]",
    );
    expect(card?.textContent).toContain("Context window");
    expect(card?.querySelector('[role="meter"]')).toBeNull();
  });

  it("shows the connect choices and no model list with nothing connected", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={[
            {
              engine: "anthropic",
              label: "Claude",
              models: ["claude-sonnet-5-5"],
              configured: false,
            },
          ]}
          selectedModel="claude-sonnet-5-5"
          selectedEngine="anthropic"
        />,
      ),
    );
    const menu = await openPicker();
    expect(topLevelRows(menu)).toEqual([]);
    expect(menu.textContent).toContain("Add your own keys");
    expect(
      menu.querySelector('[data-agent-composer-model-section="effort"]'),
    ).toBeNull();
  });

  it("shows only the setup label, with no effort, when nothing is connected", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={[
            {
              engine: "builder",
              label: "Builder.io",
              models: ["claude-opus-5-5"],
              configured: false,
            },
          ]}
          selectedModel="claude-opus-5-5"
          selectedEngine="builder"
          selectedEffort="high"
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="model-button"]',
    )!;
    expect(trigger.textContent).toBe("Connect agent");
    expect(trigger.querySelector(".agent-composer-model-effort")).toBeNull();
    expect(trigger.getAttribute("aria-label")).not.toContain("Effort");
    const menu = await openPicker();
    expect(
      menu.querySelector('[data-agent-composer-model-section="effort"]'),
    ).toBeNull();
  });

  it("selects a short-list row with its number key", async () => {
    const onModelChange = vi.fn();
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="auto"
          selectedEngine="builder"
          onModelChange={onModelChange}
        />,
      ),
    );
    const menu = await openPicker();
    await act(async () => keydown(topLevelRows(menu)[0]!, "3"));
    expect(onModelChange).toHaveBeenCalledWith("gpt-6-1-sol", "builder");
    expect(document.querySelector('[role="menu"]')).toBeNull();

    // The current row shows a check instead of 1, and 1 still selects it.
    const reopened = await openPicker();
    expect(topLevelRows(reopened)[0]!.textContent).not.toContain("1");
    await act(async () => keydown(topLevelRows(reopened)[0]!, "1"));
    expect(onModelChange).toHaveBeenLastCalledWith("auto", "builder");
  });

  it("shows the focused model's ratings, context window, and billing beside the menu", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="auto"
          selectedEngine="builder"
        />,
      ),
    );
    const menu = await openPicker();
    const opus = menu.querySelector<HTMLElement>(
      '[data-agent-composer-model-row="claude-opus-5-5"]',
    )!;
    await act(async () => opus.focus());
    const card = document.querySelector<HTMLElement>(
      "[data-agent-composer-model-card]",
    )!;
    expect(card.firstElementChild?.textContent).toBe("Opus 5.5");
    const surface = card.closest<HTMLElement>('[role="tooltip"]')!;
    expect(surface.className).toMatch(/\bp-4\b/);
    expect(surface.className).toMatch(/\bw-72\b/);
    const segments = Array.from(
      card.querySelectorAll('[role="meter"]')[2]!.children,
    ).map((segment) => segment.className.match(/bg-\w+/)?.[0]);
    expect(segments).toEqual([
      "bg-ring",
      "bg-ring",
      "bg-muted",
      "bg-muted",
      "bg-muted",
    ]);
    expect(card.textContent).toContain(
      "Most capable Claude model for complex work",
    );
    expect(
      Array.from(card.querySelectorAll('[role="meter"]')).map((meter) =>
        meter.getAttribute("aria-label"),
      ),
    ).toEqual(["Cost 5 of 5", "Reasoning 5 of 5", "Speed 2 of 5"]);
    expect(card.textContent).toContain("1M tokens");
    expect(card.textContent).toContain("Uses Builder credits");
    expect(opus.getAttribute("aria-describedby")).toBe(
      card.closest('[role="tooltip"]')?.id,
    );
    expect(document.activeElement).toBe(opus);

    await act(async () => opus.blur());
    expect(
      document.querySelector("[data-agent-composer-model-card]"),
    ).toBeNull();
  });

  it("picks effort from a submenu that marks the default level", async () => {
    const onEffortChange = vi.fn();
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="claude-opus-5-5"
          selectedEngine="builder"
          selectedEffort="max"
          onEffortChange={onEffortChange}
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="model-button"]',
    )!;
    expect(trigger.textContent).toContain("Opus 5.5");
    expect(trigger.textContent).toContain("Max");
    await openPicker();
    const effort = document.querySelector<HTMLElement>(
      '[data-agent-composer-model-section="effort"]',
    )!;
    expect(effort.textContent).toContain("Effort");
    expect(effort.textContent).toContain("Max");
    expect(effort.getAttribute("aria-haspopup")).toBe("menu");
    // The effort row sits below More models, after a separator.
    expect(effort.previousElementSibling?.getAttribute("role")).toBe(
      "separator",
    );

    await act(async () => {
      effort.focus();
      keydown(effort, "ArrowRight");
    });
    const panel = document.querySelector<HTMLElement>(
      '[data-agent-composer-model-panel="effort"]',
    )!;
    expect(panel.getAttribute("role")).toBe("menu");
    expect(panel.querySelector("p")).toBeNull();
    const levels = Array.from(
      panel.querySelectorAll<HTMLElement>("[data-agent-composer-effort-level]"),
    );
    expect(
      levels.map((level) =>
        level.getAttribute("data-agent-composer-effort-level"),
      ),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(
      levels.filter((level) => level.getAttribute("aria-checked") === "true"),
    ).toEqual([levels[4]]);
    // The badge marks the provider's default level, not a harness default.
    expect(
      levels.filter((level) => level.textContent?.includes("Recommended")),
    ).toEqual([levels[1]]);
    expect(levels[1]!.firstElementChild?.lastElementChild?.textContent).toBe(
      "Recommended",
    );
    expect(panel.textContent).not.toMatch(/usage/);

    await act(async () => levels[2]!.click());
    expect(onEffortChange).toHaveBeenLastCalledWith("high");
    expect(document.querySelector('[role="menu"]')).toBeNull();

    // Picking the provider default goes back to sending no effort.
    await openPicker();
    await act(async () => {
      const row = document.querySelector<HTMLElement>(
        '[data-agent-composer-model-section="effort"]',
      )!;
      row.focus();
      keydown(row, "ArrowRight");
    });
    await act(async () =>
      document
        .querySelector<HTMLElement>(
          '[data-agent-composer-effort-level="medium"]',
        )!
        .click(),
    );
    expect(onEffortChange).toHaveBeenLastCalledWith("auto");
  });

  it("shows the provider's default level when no effort is chosen", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="claude-opus-5-5"
          selectedEngine="builder"
          selectedEffort="auto"
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="model-button"]',
    )!;
    // The name in foreground text, then the effort in muted text, unseparated.
    const name = trigger.querySelector(".agent-composer-model-name")!;
    const effortLabel = trigger.querySelector(".agent-composer-model-effort")!;
    expect(name.className).toContain("text-foreground");
    expect(effortLabel.textContent).toBe("Medium");
    expect(effortLabel.className).toContain("text-muted-foreground");
    expect(trigger.textContent).toBe(`${name.textContent}Medium`);
    expect(trigger.textContent).not.toContain("·");
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toContain("Effort: Medium");
    await openPicker();
    const effort = document.querySelector<HTMLElement>(
      '[data-agent-composer-model-section="effort"]',
    )!;
    expect(effort.textContent).toContain("Medium");
    await act(async () => {
      effort.focus();
      keydown(effort, "ArrowRight");
    });
    const checked = Array.from(
      document.querySelectorAll("[data-agent-composer-effort-level]"),
    ).filter((level) => level.getAttribute("aria-checked") === "true");
    expect(
      checked.map((level) =>
        level.getAttribute("data-agent-composer-effort-level"),
      ),
    ).toEqual(["medium"]);
  });

  it("labels Auto plainly, adding the effort only once one is set", () => {
    const trigger = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-agent-composer-slot="model-button"]',
      )!;
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="auto"
          selectedEngine="builder"
          selectedEffort="auto"
        />,
      ),
    );
    expect(
      trigger().querySelector(".agent-composer-model-name")?.textContent,
    ).toBe("Auto");
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="auto"
          selectedEngine="builder"
          selectedEffort="high"
        />,
      ),
    );
    expect(trigger().textContent).toBe("AutoHigh");
  });

  it("shows only the model name when no effort is chosen and the provider default is unknown", () => {
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="gpt-6-1-sol"
          selectedEngine="builder"
          selectedEffort="auto"
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="model-button"]',
    )!;
    expect(trigger.textContent).toBe("GPT-6.1 Sol");
    expect(trigger.querySelector(".agent-composer-model-effort")).toBeNull();
  });

  it("hides the effort row for a model with no effort levels", async () => {
    act(() =>
      root.render(
        <Harness
          availableModels={builderGroups}
          selectedModel="gemini-3-1-pro"
          selectedEngine="builder"
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="model-button"]',
    )!;
    expect(trigger.querySelector(".agent-composer-model-effort")).toBeNull();
    const menu = await openPicker();
    expect(
      menu.querySelector('[data-agent-composer-model-section="effort"]'),
    ).toBeNull();
  });

  it("opens More models from the keyboard and closes it with one Escape", async () => {
    act(() => root.render(<Harness availableModels={builderGroups} />));
    await openPicker();
    const more = document.querySelector<HTMLElement>(
      '[data-agent-composer-model-section="more"]',
    )!;
    expect(more.getAttribute("role")).toBe("menuitem");
    await act(async () => {
      more.focus();
      keydown(more, "ArrowRight");
    });
    const panel = document.querySelector<HTMLElement>(
      '[data-agent-composer-model-panel="more"]',
    );
    expect(panel?.getAttribute("role")).toBe("menu");
    await act(async () => keydown(document.activeElement!, "Escape"));
    expect(
      document.querySelector('[data-agent-composer-model-panel="more"]'),
    ).toBeNull();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("stacks More models in one menu on a narrow viewport, without the card", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    act(() =>
      root.render(
        <Harness availableModels={builderGroups} availableAgents={agents} />,
      ),
    );
    const menu = await openPicker();

    expect(
      menu.querySelector("[data-agent-composer-model-section]"),
    ).toBeNull();
    expect(
      menu.querySelector('[data-agent-composer-model-group="more"]')
        ?.textContent,
    ).toContain("More models");
    expect(
      menu.querySelector('[data-agent-composer-model-group="agent"]')
        ?.textContent,
    ).toContain("Codex");
    expect(topLevelRows(menu)).toHaveLength(BUILDER_MODELS.length);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    await act(async () =>
      menu
        .querySelector<HTMLElement>(
          '[data-agent-composer-model-row="claude-opus-5-5"]',
        )!
        .focus(),
    );
    expect(
      document.querySelector("[data-agent-composer-model-card]"),
    ).toBeNull();
  });

  it("keeps the plain row list without a catalog", async () => {
    act(() =>
      root.render(
        <Harness availableModels={builderGroups} withCatalog={false} />,
      ),
    );
    const menu = await openPicker();
    const rows = topLevelRows(menu);
    expect(rows[1]!.textContent).toContain("GPT-6 Luna");
    expect(
      rows.every((row) => row.getAttribute("role") === "menuitemradio"),
    ).toBe(true);
  });

  it("renders the host's context control just before the model chip", () => {
    act(() =>
      root.render(
        <Harness
          contextUsageSlot={<button type="button" data-testid="ring" />}
        />,
      ),
    );
    const ringButton = container.querySelector('[data-testid="ring"]')!;
    const modelButton = container.querySelector(
      '[data-agent-composer-slot="model-button"]',
    )!;
    expect(ringButton.nextElementSibling).toBe(modelButton);
  });

  it("makes the harness docs link a real menu item", async () => {
    act(() => root.render(<Harness availableAgents={agents} />));
    await openPicker();
    await act(async () =>
      document
        .querySelector<HTMLElement>(
          '[data-agent-composer-model-section="agent"]',
        )!
        .click(),
    );
    const panel = document.querySelector(
      '[data-agent-composer-model-panel="agent"]',
    )!;
    const docs = panel.querySelector<HTMLAnchorElement>("a[href]");
    expect(docs?.getAttribute("role")).toBe("menuitem");
    expect(docs?.getAttribute("href")).toBe(
      "https://www.agent-native.com/docs/harness-agents",
    );
    expect(docs?.getAttribute("target")).toBe("_blank");
    expect(docs?.textContent).toBe("Learn more about harness agents");
  });

  it("hides the model control while a setup card offers the same choices", () => {
    const unconfigured = [
      {
        engine: "openai",
        label: "OpenAI",
        models: ["gpt-5.6-luna"],
        configured: false,
      },
    ];
    act(() =>
      root.render(<Harness availableModels={unconfigured} setupCardVisible />),
    );
    expect(
      container.querySelector('[data-agent-composer-slot="model-button"]'),
    ).toBeNull();

    // A harness agent choice is not on the card, so the control stays.
    act(() =>
      root.render(
        <Harness
          availableModels={unconfigured}
          availableAgents={agents}
          setupCardVisible
        />,
      ),
    );
    expect(
      container.querySelector('[data-agent-composer-slot="model-button"]'),
    ).not.toBeNull();
  });
});
