// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sharedEditorProps = vi.hoisted(() => ({ current: null as any }));
const modelCatalogMocks = vi.hoisted(() => ({ load: vi.fn() }));
const resourceI18nMocks = vi.hoisted(() => ({
  labels: {} as Record<string, string>,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => resourceI18nMocks.labels[key] ?? key,
}));

vi.mock("@agent-native/core/client/use-chat-models", () => ({
  loadChatModelCatalog: modelCatalogMocks.load,
}));

vi.mock("@agent-native/toolkit/editor/SharedRichEditor", async () => {
  const React = await import("react");
  return {
    SharedRichEditor: (props: any) => {
      sharedEditorProps.current = props;
      return React.createElement(
        "button",
        { type: "button", onClick: () => props.onChange("# Updated\n") },
        "Edit markdown",
      );
    },
  };
});

import { BUILDER_MODEL_CONFIG } from "@agent-native/core/agent/model-config";
import type { Resource } from "@agent-native/core/client/resources/use-resources";

import { ResourceEditor } from "./ResourceEditor.js";

const builderModelEngine = {
  name: "builder",
  label: "Builder.io Gateway",
  ...BUILDER_MODEL_CONFIG,
};
const anthropicModelEngine = {
  name: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-sonnet-5-5",
  supportedModels: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5"],
};

const resource: Resource = {
  id: "resource-1",
  path: "skills/release/SKILL.md",
  mimeType: "text/markdown",
  content: "---\nname: Release\ndescription: Ship safely\n---\n# Original\n",
  owner: "owner",
  size: 0,
  createdAt: 0,
  updatedAt: 0,
  createdBy: "user",
  visibility: "workspace",
  threadId: null,
  runId: null,
  expiresAt: null,
  metadata: null,
};

describe("ResourceEditor markdown editing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resourceI18nMocks.labels = {
      "agentResources.defaultModel": "Default model",
      "agentResources.builderModelFallback": "Builder fallback",
      "agentResources.modelOptionsUnavailable": "Model options unavailable",
    };
    modelCatalogMocks.load.mockReset();
    modelCatalogMocks.load.mockResolvedValue({
      state: "unavailable",
      enginesUnavailable: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sharedEditorProps.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("edits the markdown body while preserving and updating frontmatter", () => {
    const onSave = vi.fn();
    act(() => {
      root.render(
        <ResourceEditor resource={resource} onSave={onSave} view="visual" />,
      );
    });

    expect(sharedEditorProps.current).toMatchObject({
      value: "# Original\n",
      dialect: "gfm",
      features: { tables: false, tasks: false, image: false },
    });

    const name = container.querySelector("input")!;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(name, "Release notes");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Edit markdown")!
        .click();
      vi.advanceTimersByTime(1000);
    });

    expect(onSave).toHaveBeenLastCalledWith(
      "---\nname: Release notes\ndescription: Ship safely\n---\n# Updated\n",
    );
  });

  it("offers the current Claude models for custom agents", () => {
    const onSave = vi.fn();
    act(() => {
      root.render(
        <ResourceEditor
          resource={{
            ...resource,
            path: "agents/researcher.md",
            content:
              "---\nname: Researcher\nmodel: claude-sonnet-5-5\n---\n# Research\n",
          }}
          onSave={onSave}
          view="visual"
          modelEngine={builderModelEngine}
        />,
      );
    });

    const modelPicker = container.querySelector("select")!;
    expect(modelPicker.value).toBe("claude-sonnet-5-5");
    expect(
      Array.from(modelPicker.options).some(
        (option) =>
          option.value === "claude-sonnet-5-5" &&
          option.textContent === "Claude Sonnet 5.5",
      ),
    ).toBe(true);
    expect(
      Array.from(modelPicker.options).some(
        (option) => option.value === "claude-haiku-5-5",
      ),
    ).toBe(true);
  });

  it("preserves a saved legacy Claude model in the picker", () => {
    act(() => {
      root.render(
        <ResourceEditor
          resource={{
            ...resource,
            path: "agents/researcher.md",
            content:
              "---\nname: Researcher\nmodel: claude-haiku-4-5-20251001\n---\n# Research\n",
          }}
          onSave={vi.fn()}
          view="visual"
          modelEngine={builderModelEngine}
        />,
      );
    });

    const modelPicker = container.querySelector("select")!;
    expect(modelPicker.value).toBe("claude-haiku-4-5-20251001");
    expect(
      Array.from(modelPicker.options).some(
        (option) =>
          option.value === "claude-haiku-4-5-20251001" &&
          option.textContent ===
            "Claude Haiku 4.5 → Claude Haiku 5.5 · Builder fallback",
      ),
    ).toBe(true);
    expect(
      Array.from(modelPicker.options).some(
        (option) => option.value === "claude-haiku-5-5",
      ),
    ).toBe(true);
  });

  it("shows the saved model label outside its curated options", () => {
    resourceI18nMocks.labels["agentResources.builderModelFallback"] =
      "Modelo alternativo";
    act(() => {
      root.render(
        <ResourceEditor
          resource={{
            ...resource,
            path: "agents/researcher.md",
            content:
              "---\nname: Researcher\nmodel: claude-fable-5\n---\n# Research\n",
          }}
          onSave={vi.fn()}
          view="visual"
          modelEngine={builderModelEngine}
        />,
      );
    });

    const modelPicker = container.querySelector("select")!;
    expect(modelPicker.value).toBe("claude-fable-5");
    expect(
      Array.from(modelPicker.options).find(
        (option) => option.value === "claude-fable-5",
      )?.textContent,
    ).toBe("Claude Fable 5 → GPT-6 Luna · Modelo alternativo");
  });

  it("keeps an unchecked but runtime-supported model from showing a false fallback", () => {
    act(() => {
      root.render(
        <ResourceEditor
          resource={{
            ...resource,
            path: "agents/researcher.md",
            content:
              "---\nname: Researcher\nmodel: claude-fable-5\n---\n# Research\n",
          }}
          onSave={vi.fn()}
          view="visual"
          modelEngine={{
            name: "anthropic",
            label: "Anthropic",
            defaultModel: "claude-sonnet-5-5",
            supportedModels: [
              "claude-haiku-5-5",
              "claude-sonnet-5-5",
              "claude-fable-5",
            ],
            selectableModels: ["claude-haiku-5-5"],
          }}
        />,
      );
    });

    const modelOption = Array.from(
      container.querySelector("select")!.options,
    ).find((option) => option.value === "claude-fable-5");
    expect(modelOption?.textContent).toBe("Claude Fable 5");
  });

  it("loads model choices when a standalone custom-agent editor opens", async () => {
    modelCatalogMocks.load.mockResolvedValue({
      state: "available",
      groups: [],
      modelEngines: { anthropic: anthropicModelEngine },
      currentModelEngine: anthropicModelEngine,
      defaultModel: "claude-sonnet-5-5",
      loadLiveGroups: async () => null,
    });
    await act(async () => {
      root.render(
        <ResourceEditor
          resource={{
            ...resource,
            path: "agents/researcher.md",
            content: "---\nname: Researcher\nmodel: inherit\n---\n# Research\n",
          }}
          onSave={vi.fn()}
          view="visual"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(modelCatalogMocks.load).toHaveBeenCalledOnce();
    expect(
      Array.from(container.querySelector("select")!.options).map(
        (option) => option.value,
      ),
    ).toContain("claude-haiku-5-5");
  });

  it("offers Anthropic Fable and labels it without a Builder fallback", () => {
    act(() => {
      root.render(
        <ResourceEditor
          resource={{
            ...resource,
            path: "agents/researcher.md",
            content:
              "---\nname: Researcher\nmodel: claude-fable-5\n---\n# Research\n",
          }}
          onSave={vi.fn()}
          view="visual"
          modelEngine={anthropicModelEngine}
        />,
      );
    });

    const modelPicker = container.querySelector("select")!;
    expect(
      Array.from(modelPicker.options).some(
        (option) =>
          option.value === "claude-fable-5" &&
          option.textContent === "Claude Fable 5",
      ),
    ).toBe(true);
  });
});
