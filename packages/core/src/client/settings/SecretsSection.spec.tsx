// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip.js";
import { SecretsSection } from "./SecretsSection.js";

vi.mock("../api-path.js", () => ({
  agentNativePath: (path: string) => path,
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

async function click(element: Element | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function openNewMenu() {
  const trigger = findButton("New");
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
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
              description: "Custom service",
              last4: "5678",
              createdAt: 1,
              updatedAt: 1,
            },
          ]);
        }
        return Response.json(registeredSecrets);
      }),
    );
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
    expect(document.body.textContent).toContain("Custom");
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
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Brave Search API Key"));
    await click(braveItem);

    expect(container.textContent).toContain("Brave Search API Key");
    expect(container.textContent).not.toContain("Tavily API Key");
    expect(
      container.querySelector('input[placeholder="Paste key"]'),
    ).toBeTruthy();

    await openNewMenu();
    const customItem = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Custom");
    await click(customItem);

    expect(
      container.querySelector('input[placeholder="Paste key"]'),
    ).toBeNull();
    expect(container.querySelector('[aria-label="Key name"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Secret value"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Scope"]')).toBeTruthy();
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
});
