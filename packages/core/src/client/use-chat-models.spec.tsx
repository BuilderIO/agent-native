// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("./use-action.js", () => actionMocks);

import { invalidateClientStatusRequests } from "./client-status-requests.js";
import { useChatModels } from "./use-chat-models.js";

/** Serve the three requests refreshEngines makes: engines, env keys, builder. */
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

  it("defaults reasoning to medium", async () => {
    await act(async () => {
      root.render(<ChatModelsProbe enabled={false} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain(":medium:");
  });

  it("migrates a persisted legacy auto selection to medium", async () => {
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

    expect(container.textContent).toContain("claude-sonnet-5:medium:");
  });

  // DEFAULT_MODEL is a builder-gateway id, and the builder engine is hidden
  // from the picker unless Builder is connected. Keeping it as the selection
  // submitted a model no engine could serve, which the server then quietly
  // replaced with its own default — the picker said one thing, every turn ran
  // another.
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
    // Zero groups: an empty selection hides the picker and submits no model, so
    // the server's own resolved default is used instead of an unroutable id.
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
