// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invalidateClientStatusRequests } from "../client-status-requests.js";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { AgentSettingsContent } from "./SettingsPanel.js";

type EngineFixture = {
  name: string;
  label: string;
  defaultModel: string;
  supportedModels: string[];
  requiredEnvVars: string[];
  packageInstalled: boolean;
  configured: boolean;
};

const anthropic: EngineFixture = {
  name: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-sonnet-5",
  supportedModels: ["claude-sonnet-5"],
  requiredEnvVars: ["ANTHROPIC_API_KEY"],
  packageInstalled: true,
  configured: true,
};

const openai: EngineFixture = {
  name: "ai-sdk:openai",
  label: "OpenAI",
  defaultModel: "gpt-5.4",
  supportedModels: ["gpt-5.4", "gpt-5.4-mini"],
  requiredEnvVars: ["OPENAI_API_KEY"],
  packageInstalled: true,
  configured: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createFetchFixture({
  engines = [anthropic, openai],
  current = { engine: "anthropic", model: "claude-sonnet-5" },
  envKeys = [
    { key: "ANTHROPIC_API_KEY", configured: true },
    { key: "OPENAI_API_KEY", configured: true },
  ],
  status = {
    configured: true,
    engine: current.engine,
    source: "settings",
    envVar:
      current.engine === "ai-sdk:openai"
        ? "OPENAI_API_KEY"
        : "ANTHROPIC_API_KEY",
  },
  listResponse,
  setResponse,
  disconnectResponse,
}: {
  engines?: EngineFixture[] | (() => EngineFixture[]);
  current?: { engine: string; model: string };
  envKeys?: Array<{ key: string; configured: boolean }>;
  status?: Record<string, unknown>;
  listResponse?: (request: number) => Promise<Response> | Response;
  setResponse: () => Promise<Response> | Response;
  disconnectResponse?: () => Promise<Response> | Response;
}) {
  const setRequests: Array<Record<string, unknown>> = [];
  let listRequests = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/_agent-native/agent-chat/mode")) {
        return json({ devMode: false, canToggle: false });
      }
      if (url.includes("/_agent-native/connection-status/builder")) {
        return json({
          configured: false,
          builderEnabled: false,
          envManaged: false,
          connectUrl: "/_agent-native/builder/connect",
          appHost: "https://builder.io",
          apiHost: "https://api.builder.io",
          publicKeyConfigured: false,
          privateKeyConfigured: false,
        });
      }
      if (url.endsWith("/_agent-native/env-status")) return json(envKeys);
      if (url.endsWith("/_agent-native/agent-engine/status")) {
        return json(status);
      }
      if (url.endsWith("/_agent-native/agent-engine/disconnect")) {
        if (!disconnectResponse) throw new Error("Unexpected disconnect");
        return disconnectResponse();
      }
      if (url.endsWith("/_agent-native/actions/manage-agent-engine")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        if (body.action === "list") {
          listRequests++;
          if (listResponse) return listResponse(listRequests);
          return json({
            engines: typeof engines === "function" ? engines() : engines,
            current,
          });
        }
        if (body.action === "set") {
          setRequests.push(body);
          return setResponse();
        }
      }
      throw new Error(`Unexpected test request: ${url}`);
    },
  );
  return {
    fetchMock,
    setRequests,
    get listRequests() {
      return listRequests;
    },
  };
}

async function renderSettings(fetchMock: typeof fetch): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AgentSettingsContent sections={["llm"]} />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${name}`);
  }
  return button;
}

async function chooseOpenAi(): Promise<void> {
  const setup = Array.from(document.querySelectorAll("button")).find((button) =>
    ["Custom keys", "Manage"].includes(button.textContent?.trim() ?? ""),
  );
  if (!(setup instanceof HTMLButtonElement)) {
    throw new Error("Missing provider setup button");
  }
  await click(setup);
  const picker = document.querySelector(
    'button[aria-label="Choose a provider"]',
  );
  if (!(picker instanceof HTMLButtonElement)) {
    throw new Error("Missing provider picker");
  }
  await click(picker);
  const option = Array.from(document.querySelectorAll("[cmdk-item]")).find(
    (candidate) => candidate.textContent?.includes("OpenAI"),
  );
  if (!(option instanceof HTMLElement)) {
    throw new Error("Missing OpenAI provider option");
  }
  await click(option);
  expect(
    document.querySelector('input[list="model-suggestions-ai-sdk:openai"]'),
  ).not.toBeNull();
}

afterEach(() => {
  invalidateClientStatusRequests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("AgentSettingsContent provider save", () => {
  it("keeps Apply available and shows a bare action error without success or events", async () => {
    const fixture = createFetchFixture({
      setResponse: () => json("Error: optional packages are not installed"),
    });
    const { root } = await renderSettings(fixture.fetchMock);
    await chooseOpenAi();
    const configuredChanged = vi.fn();
    window.addEventListener(
      "agent-engine:configured-changed",
      configuredChanged,
    );

    await click(buttonNamed("Apply"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "optional packages are not installed",
    );
    expect(buttonNamed("Apply")).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "Changes take effect on next conversation",
    );
    expect(configuredChanged).not.toHaveBeenCalled();
    expect(fixture.setRequests).toHaveLength(1);
    act(() => root.unmount());
  });

  it("renders the authoritative server-normalized model after Apply", async () => {
    const fixture = createFetchFixture({
      listResponse: (request) =>
        json({
          engines: [anthropic, openai],
          current:
            request === 1
              ? { engine: "anthropic", model: "claude-sonnet-5" }
              : { engine: "ai-sdk:openai", model: "gpt-5.4-mini" },
        }),
      setResponse: () =>
        json({
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4-mini",
        }),
    });
    const { root } = await renderSettings(fixture.fetchMock);
    await chooseOpenAi();

    await click(buttonNamed("Apply"));

    const model = document.querySelector(
      'input[list="model-suggestions-ai-sdk:openai"]',
    );
    expect(model).toBeInstanceOf(HTMLInputElement);
    expect((model as HTMLInputElement).value).toBe("gpt-5.4-mini");
    expect(document.body.textContent).toContain(
      "Changes take effect on next conversation",
    );
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (candidate) => candidate.textContent?.trim() === "Apply",
      ),
    ).toBe(false);
    act(() => root.unmount());
  });

  it("reconciles a clean selection on focus after another surface changes it", async () => {
    let current = { engine: "ai-sdk:openai", model: "gpt-5.4" };
    const fixture = createFetchFixture({
      current,
      listResponse: () => json({ engines: [anthropic, openai], current }),
      setResponse: () => json({ ok: true }),
    });
    const { root } = await renderSettings(fixture.fetchMock);
    await click(buttonNamed("Manage"));

    current = { engine: "anthropic", model: "claude-sonnet-5" };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const model = document.querySelector<HTMLInputElement>(
      'input[list="model-suggestions-anthropic"]',
    );
    expect(model?.value).toBe("claude-sonnet-5");
    expect(document.body.textContent).not.toContain("Apply");
    expect(fixture.setRequests).toHaveLength(0);
    act(() => root.unmount());
  });

  it("updates the saved baseline while preserving a dirty draft on refresh", async () => {
    let current = { engine: "ai-sdk:openai", model: "gpt-5.4" };
    const fixture = createFetchFixture({
      current,
      listResponse: () => json({ engines: [anthropic, openai], current }),
      setResponse: () => json({ ok: true }),
    });
    const { root } = await renderSettings(fixture.fetchMock);
    await click(buttonNamed("Manage"));
    const model = document.querySelector<HTMLInputElement>(
      'input[list="model-suggestions-ai-sdk:openai"]',
    );
    if (!model) throw new Error("Missing model input");
    await changeInput(model, "dirty/custom-model");

    current = { engine: "ai-sdk:openai", model: "gpt-5.4-mini" };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(model.value).toBe("dirty/custom-model");
    expect(buttonNamed("Apply")).toBeTruthy();

    await changeInput(model, current.model);
    expect(document.body.textContent).not.toContain("Apply");

    current = { engine: "anthropic", model: "claude-sonnet-5" };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(
      document.querySelector<HTMLInputElement>(
        'input[list="model-suggestions-anthropic"]',
      )?.value,
    ).toBe("claude-sonnet-5");
    expect(document.body.textContent).not.toContain("Apply");
    act(() => root.unmount());
  });

  it("shows the server fallback after disconnecting a successfully saved provider", async () => {
    let current = { engine: "anthropic", model: "claude-sonnet-5" };
    const fixture = createFetchFixture({
      listResponse: () => json({ engines: [anthropic, openai], current }),
      setResponse: () => {
        current = { engine: "ai-sdk:openai", model: "gpt-5.4-mini" };
        return json({ ok: true, ...current });
      },
      disconnectResponse: () => {
        current = { engine: "anthropic", model: "claude-sonnet-5" };
        return json({ ok: true });
      },
    });
    const { root } = await renderSettings(fixture.fetchMock);
    await chooseOpenAi();
    await click(buttonNamed("Apply"));
    expect(
      document.querySelector<HTMLInputElement>(
        'input[list="model-suggestions-ai-sdk:openai"]',
      )?.value,
    ).toBe("gpt-5.4-mini");

    await click(buttonNamed("Disconnect"));

    expect(
      document.querySelector<HTMLInputElement>(
        'input[list="model-suggestions-anthropic"]',
      )?.value,
    ).toBe("claude-sonnet-5");
    expect(document.body.textContent).not.toContain("Apply");
    expect(document.body.textContent).not.toContain(
      "Changes take effect on next conversation",
    );
    expect(fixture.setRequests).toHaveLength(1);
    act(() => root.unmount());
  });

  it("does not show a provider as connected when its package and configuration are false", async () => {
    const unavailableOpenAi = {
      ...openai,
      packageInstalled: false,
      configured: false,
    };
    const fixture = createFetchFixture({
      engines: [unavailableOpenAi],
      current: { engine: "ai-sdk:openai", model: "gpt-5.4" },
      status: {
        configured: true,
        engine: "ai-sdk:openai",
        source: "settings",
        envVar: "OPENAI_API_KEY",
      },
      setResponse: () => json({ ok: true }),
    });
    const { container, root } = await renderSettings(fixture.fetchMock);

    expect(document.body.textContent).not.toContain("Connected");
    await click(buttonNamed("Manage"));
    const picker = document.querySelector(
      'button[aria-label="Choose a provider"]',
    );
    if (!(picker instanceof HTMLButtonElement)) {
      throw new Error("Missing provider picker");
    }
    await click(picker);
    const openAiOption = Array.from(
      document.querySelectorAll("[cmdk-item]"),
    ).find((candidate) => candidate.textContent?.includes("OpenAI"));
    expect(openAiOption?.textContent).not.toContain("Configured");
    act(() => root.unmount());
  });

  it("disables the form and prevents duplicate Apply requests while pending", async () => {
    let resolveSet!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveSet = resolve;
    });
    const fixture = createFetchFixture({ setResponse: () => pending });
    const { root } = await renderSettings(fixture.fetchMock);
    await chooseOpenAi();

    const apply = buttonNamed("Apply");
    await click(apply);
    const fieldset = apply.closest("fieldset");
    expect(fieldset).toBeInstanceOf(HTMLFieldSetElement);
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(true);
    await click(apply);
    expect(fixture.setRequests).toHaveLength(1);

    await act(async () => {
      resolveSet(
        json({
          ok: true,
          engine: "ai-sdk:openai",
          model: "gpt-5.4",
        }),
      );
      await pending;
      await Promise.resolve();
    });
    act(() => root.unmount());
  });

  it("refreshes configured engine metadata without resetting a dirty model", async () => {
    let configured = false;
    const fixture = createFetchFixture({
      engines: () => [{ ...openai, configured }],
      current: { engine: "ai-sdk:openai", model: "gpt-5.4" },
      status: {
        configured: true,
        engine: "ai-sdk:openai",
        source: "settings",
        envVar: "OPENAI_API_KEY",
      },
      setResponse: () => json({ ok: true }),
    });
    const { root } = await renderSettings(fixture.fetchMock);
    await click(buttonNamed("Manage"));
    const model = document.querySelector(
      'input[list="model-suggestions-ai-sdk:openai"]',
    );
    if (!(model instanceof HTMLInputElement)) {
      throw new Error("Missing OpenAI model input");
    }
    await changeInput(model, "dirty/custom-model");
    const test = buttonNamed("Test");
    expect(test.disabled).toBe(true);

    configured = true;
    await act(async () => {
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.listRequests).toBe(2);
    expect(model.value).toBe("dirty/custom-model");
    expect(test.disabled).toBe(false);
    act(() => root.unmount());
  });

  it("hydrates authoritative current state after initial failure without clobbering edits", async () => {
    const fixture = createFetchFixture({
      listResponse: (request) =>
        request === 1
          ? json({ error: "catalog unavailable" }, 503)
          : json({
              engines: [anthropic, openai],
              current: {
                engine: "ai-sdk:openai",
                model: "server/current-model",
              },
            }),
      setResponse: () => json({ ok: true }),
    });
    const { root } = await renderSettings(fixture.fetchMock);
    await chooseOpenAi();
    const model = document.querySelector(
      'input[list="model-suggestions-ai-sdk:openai"]',
    );
    if (!(model instanceof HTMLInputElement)) {
      throw new Error("Missing OpenAI model input");
    }
    await changeInput(model, "dirty/custom-model");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.listRequests).toBe(2);
    expect(model.value).toBe("dirty/custom-model");
    expect(buttonNamed("Apply")).toBeTruthy();

    await changeInput(model, "server/current-model");
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (candidate) => candidate.textContent?.trim() === "Apply",
      ),
    ).toBe(false);
    act(() => root.unmount());
  });

  it("treats a failed refresh as unknown until a later focus recovers", async () => {
    const fixture = createFetchFixture({
      current: { engine: "ai-sdk:openai", model: "gpt-5.4" },
      listResponse: (request) =>
        request === 2
          ? json({ error: "catalog unavailable" }, 503)
          : json({
              engines: [openai],
              current: { engine: "ai-sdk:openai", model: "gpt-5.4" },
            }),
      setResponse: () => json({ ok: true }),
    });
    const { root } = await renderSettings(fixture.fetchMock);
    await click(buttonNamed("Manage"));
    const model = document.querySelector(
      'input[list="model-suggestions-ai-sdk:openai"]',
    );
    if (!(model instanceof HTMLInputElement)) {
      throw new Error("Missing OpenAI model input");
    }
    await changeInput(model, "dirty/custom-model");
    const test = buttonNamed("Test");
    expect(test.disabled).toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.listRequests).toBe(2);
    expect(test.disabled).toBe(true);
    expect(document.body.textContent).not.toContain("Connected via");
    const picker = document.querySelector(
      'button[aria-label="Choose a provider"]',
    );
    if (!(picker instanceof HTMLButtonElement)) {
      throw new Error("Missing provider picker");
    }
    await click(picker);
    const openAiOption = Array.from(
      document.querySelectorAll("[cmdk-item]"),
    ).find((candidate) => candidate.textContent?.includes("OpenAI"));
    expect(openAiOption?.textContent).not.toContain("Configured");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.listRequests).toBe(3);
    expect(model.value).toBe("dirty/custom-model");
    expect(test.disabled).toBe(false);
    act(() => root.unmount());
  });
});
