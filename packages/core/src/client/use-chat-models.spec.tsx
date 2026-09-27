// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("./use-action.js", () => actionMocks);

import { invalidateClientStatusRequests } from "./client-status-requests.js";
import { useChatModels } from "./use-chat-models.js";

function stubCatalog(options: {
  engines: unknown[];
  configuredKeys?: string[];
  current?: { engine: string; model: string };
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
        return Response.json({ configured: false });
      }
      return new Response("{}");
    }),
  );
}

function ChatModelsProbe({
  enabled,
  storageKey = null,
  id = "probe",
}: {
  enabled: boolean;
  storageKey?: string | null;
  id?: string;
}) {
  const models = useChatModels({ enabled, storageKey });
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
