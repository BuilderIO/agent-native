// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("./use-action.js", () => actionMocks);

import { invalidateClientStatusRequests } from "./client-status-requests.js";
import { useChatModels, type UseChatModelsOptions } from "./use-chat-models.js";

function stubCatalog(options: {
  engines: unknown[];
  configuredKeys?: string[];
  current?: { engine: string; model: string };
  builderConnected?: boolean;
}) {
  actionMocks.callAction.mockResolvedValue({
    engines: options.engines,
    ...(options.current ? { current: options.current } : {}),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("env-status")) {
        return Response.json(
          (options.configuredKeys ?? []).map((key) => ({
            key,
            configured: true,
          })),
        );
      }
      if (url.includes("builder/status")) {
        return Response.json({ configured: options.builderConnected === true });
      }
      return new Response("{}");
    }),
  );
}

function ChatModelsProbe({
  enabled,
  storageKey = null,
  id = "probe",
  unavailableSelectionPolicy,
}: {
  enabled: boolean;
  storageKey?: string | null;
  id?: string;
  unavailableSelectionPolicy?: UseChatModelsOptions["unavailableSelectionPolicy"];
}) {
  const models = useChatModels({
    enabled,
    storageKey,
    unavailableSelectionPolicy,
  });
  return (
    <div>
      <button type="button" onClick={models.refreshEngines}>
        {models.selectedModel}:{models.selectedEffort}:
        {models.availableModels.length}
      </button>
      <button
        type="button"
        data-testid={`${id}-change-model`}
        onClick={() => models.onModelChange("claude-sonnet-5", "anthropic")}
      >
        Change model
      </button>
      <span data-testid={`${id}-selected-model`}>{models.selectedModel}</span>
      <span data-testid={`${id}-catalog-state`}>
        {models.availableModels
          .map((group) => `${group.engine}:${group.configured}`)
          .join(",")}
      </span>
      <span data-testid={`${id}-configured-catalog`}>
        {models.configuredModels
          .map(
            (group) =>
              `${group.label}:${group.engine}:${group.models.join("|")}`,
          )
          .join(",")}
      </span>
      <span data-testid={`${id}-selection-ready`}>
        {String(models.selectionReady)}
      </span>
      <span data-testid={`${id}-unavailable-selection`}>
        {models.unavailableSelection
          ? `${models.unavailableSelection.engine}:${models.unavailableSelection.model}`
          : ""}
      </span>
      <span data-testid={`${id}-ollama-models`}>
        {(
          models.availableModels.find(
            (group) => group.engine === "ai-sdk:ollama",
          )?.models ?? []
        ).join(",")}
      </span>
    </div>
  );
}

describe("useChatModels", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const stored = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => stored.clear(),
        getItem: (key: string) => stored.get(key) ?? null,
        key: (index: number) => [...stored.keys()][index] ?? null,
        get length() {
          return stored.size;
        },
        removeItem: (key: string) => stored.delete(key),
        setItem: (key: string, value: string) => stored.set(key, String(value)),
      } satisfies Storage,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    invalidateClientStatusRequests();
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not probe framework model endpoints when disabled", async () => {
    await act(async () => {
      root.render(<ChatModelsProbe enabled={false} />);
      await Promise.resolve();
    });

    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("upgrades a persisted Builder default before selecting it for a fresh chat", async () => {
    stubCatalog({
      builderConnected: true,
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["gemini-3-8-flash"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
      ],
      current: { engine: "builder", model: "gemini-3-7-flash" },
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey="fresh-builder-chat" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("gemini-3-8-flash");
  });

  it("defaults effort to high", async () => {
    await act(async () => {
      root.render(<ChatModelsProbe enabled={false} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain(":high:");
  });

  it("migrates a persisted legacy auto selection to high", async () => {
    window.localStorage.setItem(
      "legacy-reasoning-selection",
      JSON.stringify({ model: "claude-sonnet-5", effort: "auto" }),
    );

    await act(async () => {
      root.render(
        <ChatModelsProbe
          enabled={false}
          storageKey="legacy-reasoning-selection"
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("claude-sonnet-5:high:");
  });

  it("upgrades a persisted GPT selection to the newest model in that engine", async () => {
    const storageKey = "legacy-gpt-model-selection";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        engine: "ai-sdk:openai",
        model: "gpt-5.6-luna",
        effort: "high",
      }),
    );
    stubCatalog({
      engines: [
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-6-luna"],
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
      configuredKeys: ["OPENAI_API_KEY"],
      current: { engine: "ai-sdk:openai", model: "gpt-5.6-luna" },
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("gpt-6-luna");
    expect(
      JSON.parse(window.localStorage.getItem(storageKey) ?? "{}").model,
    ).toBe("gpt-6-luna");
  });

  it.each([
    ["claude-sonnet-5", "claude-sonnet-5-5"],
    ["gpt-6.1-sol", "gpt-6-1-sol"],
    ["gemini-3-7-flash", "gemini-3-8-flash"],
  ])(
    "upgrades a persisted Builder model alias from %s to %s",
    async (model, expected) => {
      const storageKey = "legacy-builder-model-selection";
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ engine: "builder", model, effort: "high" }),
      );
      stubCatalog({
        builderConnected: true,
        engines: [
          {
            name: "builder",
            label: "Builder.io Gateway",
            supportedModels: [expected],
            requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
          },
        ],
      });

      await act(async () => {
        root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        container.querySelector('[data-testid="probe-selected-model"]')
          ?.textContent,
      ).toBe(expected);
      expect(
        JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"),
      ).toEqual({ engine: "builder", model: expected, effort: "high" });
    },
  );

  it("keeps a supported Anthropic model when a Builder alias is newer", async () => {
    const storageKey = "byok-claude-model-selection";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        engine: "anthropic",
        model: "claude-sonnet-5",
        effort: "high",
      }),
    );
    stubCatalog({
      configuredKeys: ["ANTHROPIC_API_KEY"],
      engines: [
        {
          name: "anthropic",
          label: "Anthropic",
          supportedModels: ["claude-sonnet-5", "claude-sonnet-5-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
      ],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("claude-sonnet-5");
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      { engine: "anthropic", model: "claude-sonnet-5", effort: "high" },
    );
  });

  it("upgrades a saved OpenRouter GPT model when its catalog lists the newer version", async () => {
    const storageKey = "legacy-openrouter-gpt-model-selection";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        engine: "ai-sdk:openrouter",
        model: "openai/gpt-5.6-luna",
        effort: "high",
      }),
    );
    stubCatalog({
      engines: [
        {
          name: "ai-sdk:openrouter",
          label: "OpenRouter",
          supportedModels: ["openai/gpt-5.6-luna", "openai/gpt-6-luna"],
          preserveCustomModels: true,
          requiredEnvVars: ["OPENROUTER_API_KEY"],
        },
      ],
      configuredKeys: ["OPENROUTER_API_KEY"],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("openai/gpt-6-luna");
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      {
        engine: "ai-sdk:openrouter",
        model: "openai/gpt-6-luna",
        effort: "high",
      },
    );
  });

  it("keeps a saved OpenRouter GPT model when its checked catalog lacks an upgrade", async () => {
    const storageKey = "checked-openrouter-gpt-model-selection";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        engine: "ai-sdk:openrouter",
        model: "openai/gpt-5.6-luna",
        effort: "high",
      }),
    );
    stubCatalog({
      engines: [
        {
          name: "ai-sdk:openrouter",
          label: "OpenRouter",
          supportedModels: ["openai/gpt-5.6-luna"],
          modelSelection: { state: "selected", scope: "user" },
          preserveCustomModels: true,
          requiredEnvVars: ["OPENROUTER_API_KEY"],
        },
      ],
      configuredKeys: ["OPENROUTER_API_KEY"],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("openai/gpt-5.6-luna");
    expect(
      JSON.parse(window.localStorage.getItem(storageKey) ?? "{}").model,
    ).toBe("openai/gpt-5.6-luna");
  });

  it("preserves an explicit custom model for its OpenAI-compatible endpoint", async () => {
    const storageKey = "custom-gateway-model-selection";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        engine: "ai-sdk:openai",
        model: "acme/custom-chat-v2",
        effort: "high",
      }),
    );
    stubCatalog({
      engines: [
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-6-luna"],
          preserveCustomModels: true,
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
      configuredKeys: ["OPENAI_API_KEY"],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("acme/custom-chat-v2");
    expect(
      JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"),
    ).toMatchObject({
      engine: "ai-sdk:openai",
      model: "acme/custom-chat-v2",
    });
  });

  it("upgrades an unscoped legacy model only through a configured engine", async () => {
    const storageKey = "legacy-gpt-model-without-engine";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ model: "gpt-5.6-luna", effort: "high" }),
    );
    stubCatalog({
      builderConnected: true,
      engines: [
        {
          name: "builder",
          label: "Builder.io Gateway",
          supportedModels: ["gpt-6-luna"],
          requiredEnvVars: ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"],
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-6-luna"],
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("gpt-6-luna");
    expect(
      JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"),
    ).toMatchObject({
      engine: "builder",
      model: "gpt-6-luna",
    });
  });

  it("persists the configured engine inferred for an unchanged unscoped model", async () => {
    const storageKey = "legacy-model-without-engine";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ model: "claude-sonnet-5", effort: "high" }),
    );
    stubCatalog({
      engines: [
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
      ],
      configuredKeys: ["ANTHROPIC_API_KEY"],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      {
        engine: "anthropic",
        model: "claude-sonnet-5",
        effort: "high",
      },
    );
  });

  it("upgrades an unscoped legacy model through one custom endpoint candidate", async () => {
    const storageKey = "legacy-custom-model-without-engine";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ model: "gpt-5.6-luna", effort: "high" }),
    );
    stubCatalog({
      engines: [
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-6-luna"],
          preserveCustomModels: true,
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
      configuredKeys: ["OPENAI_API_KEY"],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("gpt-6-luna");
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      {
        engine: "ai-sdk:openai",
        model: "gpt-6-luna",
        effort: "high",
      },
    );
  });

  it("does not infer an unscoped custom model across multiple gateway groups", async () => {
    const storageKey = "legacy-ambiguous-custom-model";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ model: "acme/custom-chat-v2", effort: "high" }),
    );
    stubCatalog({
      engines: [
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-6-luna"],
          preserveCustomModels: true,
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
        {
          name: "ai-sdk:openrouter",
          label: "OpenRouter",
          supportedModels: ["gpt-6-luna"],
          preserveCustomModels: true,
          requiredEnvVars: ["OPENROUTER_API_KEY"],
        },
      ],
      configuredKeys: ["OPENAI_API_KEY", "OPENROUTER_API_KEY"],
      current: { engine: "ai-sdk:openai", model: "gpt-6-luna" },
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey={storageKey} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("gpt-6-luna");
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      {
        engine: "ai-sdk:openai",
        model: "gpt-6-luna",
        effort: "high",
      },
    );
  });

  it("replaces an unroutable default with a model the catalog can serve", async () => {
    stubCatalog({
      engines: [
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5", "claude-opus-4-8"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
      ],
      configuredKeys: ["ANTHROPIC_API_KEY"],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey="routable-selection" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const selected = container.querySelector(
      '[data-testid="probe-selected-model"]',
    )?.textContent;
    expect(selected).not.toBe("gpt-5-6-luna");
    expect(["claude-sonnet-5", "claude-opus-4-8"]).toContain(selected);
  });

  it("refreshes the active picker catalog after engine configuration changes", async () => {
    const engines: unknown[] = [
      {
        name: "anthropic",
        label: "Claude",
        supportedModels: ["claude-sonnet-5"],
        requiredEnvVars: ["ANTHROPIC_API_KEY"],
      },
    ];
    actionMocks.callAction.mockImplementation(async () => ({ engines }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("env-status")) {
          return Response.json([
            { key: "ANTHROPIC_API_KEY", configured: true },
          ]);
        }
        if (url.includes("builder/status")) {
          return Response.json({ configured: false });
        }
        return new Response("{}");
      }),
    );

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey="lab-catalog-refresh" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const catalog = container.querySelector(
      '[data-testid="probe-catalog-state"]',
    );
    expect(catalog?.textContent).toBe("anthropic:true");

    engines.push({
      name: "chatgpt-subscription",
      label: "ChatGPT plan access",
      supportedModels: ["gpt-5.6-sol"],
      requiredEnvVars: [],
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(catalog?.textContent).toBe(
      "anthropic:true,chatgpt-subscription:true",
    );
  });

  it("clears the selection when the catalog can route nothing", async () => {
    stubCatalog({ engines: [] });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey="empty-catalog" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("");
  });

  it("requires an explicit replacement when a stored provider model is unavailable", async () => {
    const storageKey = "comment-ai-model-selection";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        engine: "builder",
        model: "gpt-retired",
        effort: "high",
      }),
    );
    stubCatalog({
      engines: [
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
        {
          name: "ai-sdk:openai",
          label: "OpenAI",
          supportedModels: ["gpt-5.6-sol"],
          requiredEnvVars: ["OPENAI_API_KEY"],
        },
      ],
      configuredKeys: ["ANTHROPIC_API_KEY"],
    });

    await act(async () => {
      root.render(
        <ChatModelsProbe
          enabled
          storageKey={storageKey}
          unavailableSelectionPolicy="require-explicit"
        />,
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selected-model"]')
        ?.textContent,
    ).toBe("");
    expect(
      container.querySelector('[data-testid="probe-selection-ready"]')
        ?.textContent,
    ).toBe("false");
    expect(
      container.querySelector('[data-testid="probe-unavailable-selection"]')
        ?.textContent,
    ).toBe("builder:gpt-retired");
    expect(
      container.querySelector('[data-testid="probe-configured-catalog"]')
        ?.textContent,
    ).toBe("Claude:anthropic:claude-sonnet-5");
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      {
        engine: "builder",
        model: "gpt-retired",
        effort: "high",
      },
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="probe-unavailable-selection"]')
        ?.textContent,
    ).toBe("builder:gpt-retired");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="probe-change-model"]')
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-selection-ready"]')
        ?.textContent,
    ).toBe("true");
    expect(
      container.querySelector('[data-testid="probe-unavailable-selection"]')
        ?.textContent,
    ).toBe("");
  });

  it("replaces the static Ollama suggestion list with the server's installed models", async () => {
    actionMocks.callAction.mockResolvedValue({
      engines: [
        {
          name: "ai-sdk:ollama",
          label: "Ollama",
          supportedModels: ["llama3.1", "llama3.2", "mistral", "codestral"],
          requiredEnvVars: [],
        },
      ],
      current: { engine: "ai-sdk:ollama", model: "llama3.1" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("env-status")) return Response.json([]);
        if (url.includes("builder/status")) {
          return Response.json({ configured: false });
        }
        if (url.includes("ollama-models")) {
          return Response.json({
            ok: true,
            models: ["qwen3.8-code-131k:latest", "mistral:latest"],
          });
        }
        return new Response("{}");
      }),
    );

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey="ollama-live-models" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-ollama-models"]')
        ?.textContent,
    ).toBe("qwen3.8-code-131k:latest,mistral:latest");
  });

  it("keeps checked Ollama models instead of probing installed ones", async () => {
    actionMocks.callAction.mockResolvedValue({
      engines: [
        {
          name: "ai-sdk:ollama",
          label: "Ollama",
          supportedModels: ["mistral:latest"],
          modelSelection: { state: "selected", scope: "user" },
          requiredEnvVars: [],
        },
      ],
      current: { engine: "ai-sdk:ollama", model: "mistral:latest" },
    });
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("env-status")) return Response.json([]);
      if (url.includes("builder/status")) {
        return Response.json({ configured: false });
      }
      if (url.includes("ollama-models")) {
        return Response.json({
          ok: true,
          models: ["qwen3.8-code-131k:latest", "mistral:latest"],
        });
      }
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey="ollama-checked" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="probe-ollama-models"]')
        ?.textContent,
    ).toBe("mistral:latest");
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("ollama-models"),
      ),
    ).toBe(false);
  });

  it("keeps the last model readiness when status refresh is unavailable", async () => {
    stubCatalog({
      engines: [
        {
          name: "anthropic",
          label: "Claude",
          supportedModels: ["claude-sonnet-5"],
          requiredEnvVars: ["ANTHROPIC_API_KEY"],
        },
      ],
      configuredKeys: ["ANTHROPIC_API_KEY"],
    });

    await act(async () => {
      root.render(<ChatModelsProbe enabled storageKey="stable-catalog" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const catalog = container.querySelector(
      '[data-testid="probe-catalog-state"]',
    );
    expect(catalog?.textContent).toBe("anthropic:true");

    invalidateClientStatusRequests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("down"))),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(catalog?.textContent).toBe("anthropic:true");
  });

  it("retries model discovery after a transient readiness failure", async () => {
    vi.useFakeTimers();
    try {
      actionMocks.callAction.mockResolvedValue({
        engines: [
          {
            name: "anthropic",
            label: "Claude",
            supportedModels: ["claude-sonnet-5"],
            requiredEnvVars: ["ANTHROPIC_API_KEY"],
          },
        ],
      });
      let environmentAttempts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown) => {
          const url = String(input);
          if (url.includes("env-status")) {
            environmentAttempts += 1;
            if (environmentAttempts === 1) {
              return new Response("temporarily unavailable", { status: 503 });
            }
            return Response.json([
              { key: "ANTHROPIC_API_KEY", configured: true },
            ]);
          }
          if (url.includes("builder/status")) {
            return Response.json({ configured: false });
          }
          return new Response("{}");
        }),
      );

      await act(async () => {
        root.render(<ChatModelsProbe enabled storageKey="retry-selection" />);
        await Promise.resolve();
      });
      expect(
        container.querySelector('[data-testid="probe-catalog-state"]')
          ?.textContent,
      ).toBe("");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(environmentAttempts).toBe(2);
      expect(
        container.querySelector('[data-testid="probe-catalog-state"]')
          ?.textContent,
      ).toBe("anthropic:true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("syncs same-page model changes between hooks sharing a storage key", async () => {
    await act(async () => {
      root.render(
        <>
          <ChatModelsProbe
            enabled={false}
            id="first"
            storageKey="shared-model-selection"
          />
          <ChatModelsProbe
            enabled={false}
            id="second"
            storageKey="shared-model-selection"
          />
        </>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="first-change-model"]')
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="second-selected-model"]')
        ?.textContent,
    ).toBe("claude-sonnet-5");
  });
});
