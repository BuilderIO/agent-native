// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip.js";
import { SecretsSection } from "./SecretsSection.js";

vi.mock("../api-path.js", () => ({
  agentNativePath: (path: string) => path,
  appMountedPath: (path: string) => path,
}));

vi.mock("../org/workspace-app-links.js", () => ({
  useOrgSwitcherAppLinks: () => ({
    isWorkspace: true,
    dispatchVaultHref: "/dispatch/vault",
    apps: [],
    isLoading: false,
    dispatchHref: "",
    dispatchAllAppsHref: "",
  }),
}));

const registeredSecrets = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API key",
    description: "OpenAI services",
    scope: "user",
    kind: "api-key",
    required: false,
    status: "set",
    source: "personal",
    managedHere: true,
    last4: "1234",
  },
  {
    key: "BRAVE_SEARCH_API_KEY",
    label: "Brave Search API Key",
    description: "Web search through Brave",
    scope: "workspace",
    kind: "api-key",
    required: false,
    status: "unset",
  },
  {
    key: "TAVILY_API_KEY",
    label: "Tavily API Key",
    description: "Web search through Tavily",
    scope: "workspace",
    kind: "api-key",
    required: false,
    status: "unset",
  },
];

function findButton(text: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

function renderSecretsSection(root: Root, focusKey?: string) {
  root.render(
    <TooltipProvider>
      <SecretsSection focusKey={focusKey} />
    </TooltipProvider>,
  );
}

async function click(element: Element | undefined | null) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function openNewMenu() {
  await click(findButton("New"));
}

async function openRow(label: string) {
  const toggle = Array.from(document.querySelectorAll("button")).find(
    (button) =>
      button.hasAttribute("aria-expanded") &&
      button.textContent?.includes(label),
  );
  await click(toggle);
}

function mockFetchWithSecrets(secrets: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/secrets/adhoc")) {
        return Response.json([
          {
            name: "CUSTOM_TOKEN",
            scope: "user",
            scopeId: "user-1",
            source: "personal",
            description: "Custom service",
            last4: "5678",
            createdAt: 1,
            updatedAt: 1,
          },
        ]);
      }
      return Response.json(secrets);
    }),
  );
}

describe("SecretsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mockFetchWithSecrets(registeredSecrets);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("shows configured keys while keeping unset providers behind New", async () => {
    await act(async () => {
      renderSecretsSection(root);
    });

    expect(container.textContent).toContain("OpenAI API key");
    expect(container.textContent).toContain("CUSTOM_TOKEN");
    expect(container.textContent).not.toContain("Brave Search API Key");
    expect(container.textContent).not.toContain("Tavily API Key");
    expect(
      container.querySelector('input[placeholder="Paste key"]'),
    ).toBeNull();

    await openNewMenu();

    expect(document.body.textContent).toContain("Brave Search API Key");
    expect(document.body.textContent).toContain("Tavily API Key");
    expect(document.body.textContent).toContain("Custom key");
    expect(document.body.textContent).not.toContain(
      "Choose a keyOpenAI API key",
    );
  });

  it("opens only the selected preset or custom key form", async () => {
    await act(async () => {
      renderSecretsSection(root);
    });

    await openNewMenu();
    const braveItem = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((item) => item.textContent?.includes("Brave Search API Key"));
    await click(braveItem);

    expect(container.textContent).toContain("Brave Search API Key");
    expect(container.textContent).not.toContain("Tavily API Key");
    expect(
      container.querySelector('input[placeholder="Paste key"]'),
    ).toBeTruthy();

    await openNewMenu();
    const customItem = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((item) => item.textContent?.includes("Custom key"));
    await click(customItem);

    expect(
      container.querySelector('input[placeholder="Paste key"]'),
    ).toBeNull();
    expect(container.querySelector('[aria-label="Key name"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Secret value"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Scope"]')).toBeTruthy();
  });

  it("filters the key list as you search", async () => {
    await act(async () => {
      renderSecretsSection(root);
    });

    await openNewMenu();
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search keys..."]',
    );
    expect(search).toBeTruthy();

    await act(async () => {
      // React's value tracker ignores a plain assignment; go through the
      // prototype setter so onChange actually fires.
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "tavily");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const optionText = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).map((item) => item.textContent ?? "");
    expect(optionText.some((text) => text.includes("Tavily API Key"))).toBe(
      true,
    );
    expect(
      optionText.some((text) => text.includes("Brave Search API Key")),
    ).toBe(false);
  });

  it("reveals and focuses an unset key requested by a deep link", async () => {
    await act(async () => {
      renderSecretsSection(root, "TAVILY_API_KEY");
    });

    expect(container.textContent).toContain("Tavily API Key");
    expect(container.textContent).not.toContain("Brave Search API Key");
    expect(container.querySelector('input[placeholder="Paste key"]')).toBe(
      document.activeElement,
    );
  });

  it("shows a Vault-provided key as shadowed with no Rotate/Remove", async () => {
    mockFetchWithSecrets([
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI API key",
        description: "OpenAI services",
        scope: "user",
        kind: "api-key",
        required: false,
        status: "set",
        source: "vault",
        managedHere: false,
        last4: "1234",
      },
    ]);

    await act(async () => {
      renderSecretsSection(root);
    });

    expect(container.textContent).toContain("Set · Vault");

    await openRow("OpenAI API key");

    expect(container.textContent).toContain(
      "Managed in the workspace Vault. Every app in this workspace uses this value.",
    );
    expect(findButton("Rotate")).toBeUndefined();
    expect(findButton("Delete")).toBeUndefined();
  });

  it("adds a custom key by typed name from the New search", async () => {
    await act(async () => {
      renderSecretsSection(root);
    });

    await openNewMenu();
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search keys..."]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "hubspot");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const customItem = Array.from(
      document.querySelectorAll('[role="option"]'),
    ).find((item) => item.textContent?.includes("HUBSPOT"));
    expect(customItem?.textContent).toContain("Add “HUBSPOT” as a custom key");

    await click(customItem);

    const nameInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Key name"]',
    );
    expect(nameInput?.value).toBe("HUBSPOT");
  });

  it("shows provider tiles when no key is set yet, and opens the picked row", async () => {
    mockFetchWithSecrets([
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI API key",
        scope: "user",
        kind: "api-key",
        required: false,
        status: "unset",
      },
      {
        key: "ANTHROPIC_API_KEY",
        label: "Anthropic API key",
        scope: "user",
        kind: "api-key",
        required: false,
        status: "unset",
      },
    ]);

    await act(async () => {
      renderSecretsSection(root);
    });

    expect(container.textContent).toContain("No keys yet.");
    expect(container.textContent).toContain(
      "Add a key to use your own accounts.",
    );

    const tile = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "OpenAI",
    );
    expect(tile?.querySelector("img")).toBeTruthy();
    await click(tile);

    expect(container.textContent).toContain("OpenAI API key");
    expect(container.querySelector('input[placeholder="Paste key"]')).toBe(
      document.activeElement,
    );
  });

  it("hides the provider tiles once a key is set", async () => {
    await act(async () => {
      renderSecretsSection(root);
    });

    expect(container.textContent).not.toContain("No keys yet.");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Brave",
      ),
    ).toBe(false);
  });

  it("shows how many more keys are under New past the first 8 tiles", async () => {
    mockFetchWithSecrets(
      Array.from({ length: 9 }, (_, i) => ({
        key: `PROVIDER_${i}_API_KEY`,
        label: `Provider ${i} API key`,
        scope: "user",
        kind: "api-key",
        required: false,
        status: "unset",
      })),
    );

    await act(async () => {
      renderSecretsSection(root);
    });

    expect(container.textContent).toContain(
      "and 1 more under New, or add any custom key",
    );
  });

  it("shows the overrides note for a personal key shadowing the Vault", async () => {
    mockFetchWithSecrets([
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI API key",
        description: "OpenAI services",
        scope: "user",
        kind: "api-key",
        required: false,
        status: "set",
        source: "personal",
        managedHere: true,
        overrides: "vault",
        last4: "1234",
      },
    ]);

    await act(async () => {
      renderSecretsSection(root);
    });

    await openRow("OpenAI API key");

    expect(container.textContent).toContain(
      "This personal key overrides the workspace Vault value. Remove it to use the Vault key.",
    );
  });
});
