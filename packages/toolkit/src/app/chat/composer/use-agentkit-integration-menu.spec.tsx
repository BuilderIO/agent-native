// @vitest-environment happy-dom
import { ComposerContextMenu } from "@agent-native/toolkit/composer";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../i18n/catalogs/en-US.js";
import { useAgentKitIntegrationMenu } from "./use-agentkit-integration-menu.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => {
    const message = (englishMessages as Record<string, string>)[
      key.replace(/^agentChat\./, "")
    ];
    if (typeof message !== "string")
      throw new Error(`Missing translation: ${key}`);
    return message;
  },
}));

type Capabilities = Parameters<
  typeof useAgentKitIntegrationMenu
>[0]["capabilities"];

describe("shared AgentKit integration submenu", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let capabilities: Capabilities;
  const onSelect = vi.fn();
  let pathname = "";
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      () => {},
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onSelect.mockReset();
    capabilities = {
      data: { sources: { figma: { available: false } }, integrations: [] },
      integrationsLoading: false,
      integrationsError: null,
      refetchIntegrations: vi.fn(),
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function Harness() {
    pathname = useLocation().pathname;
    const item = useAgentKitIntegrationMenu({
      capabilities,
      scopeKey: "user:org",
      onSelect,
    });
    return <ComposerContextMenu items={[item]} />;
  }
  async function render() {
    await act(async () =>
      root.render(
        <MemoryRouter basename="/design" initialEntries={["/design/home"]}>
          <TooltipProvider>
            <Harness />
          </TooltipProvider>
        </MemoryRouter>,
      ),
    );
  }
  async function key(element: HTMLElement, key: string) {
    await act(async () => {
      element.focus();
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  function row(label: string) {
    const element = [
      ...document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    ].find((element) => element.textContent === label);
    expect(element, label).toBeDefined();
    return element!;
  }
  async function open() {
    await key(
      container.querySelector('button[aria-label="Add context"]')!,
      "ArrowDown",
    );
    await key(row("Add context"), "ArrowRight");
    expect(row("Integrations").getAttribute("aria-haspopup")).toBe("menu");
    await key(row("Integrations"), "ArrowRight");
  }
  it("opens an empty submenu without navigating and offers an app-relative connection link", async () => {
    await render();
    await open();
    expect(pathname).toBe("/home");
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(3);
    expect(document.body.textContent).toContain(
      "No integrations available for this app.",
    );
    const link = row("Connect an integration…");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/design/settings/integrations");
    expect(link.querySelector("svg")).toBeNull();
    await act(async () => link.click());
    expect(pathname).toBe("/settings/integrations");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("lists only supplied capabilities and selects a provider without navigating", async () => {
    const github = {
      id: "github",
      label: "GitHub",
      kind: "provider-api" as const,
    };
    capabilities.data!.integrations = [
      github,
      { id: "mcp:slack", label: "Slack", kind: "mcp" },
    ];
    await render();
    await key(
      container.querySelector('button[aria-label="Add context"]')!,
      "ArrowDown",
    );
    expect(document.body.textContent).not.toContain("GitHub");
    await key(row("Add context"), "ArrowRight");
    await key(row("Integrations"), "ArrowRight");
    expect(row("GitHub").querySelector("svg")).toBeNull();
    expect(row("Slack")).toBeDefined();
    expect(row("Manage integrations…").getAttribute("href")).toBe(
      "/design/settings/integrations",
    );
    await key(row("GitHub"), "Enter");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(github);
    expect(pathname).toBe("/home");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
  it("does not show an empty connection state while loading or after a read failure", async () => {
    capabilities = {
      ...capabilities,
      data: undefined,
      integrationsLoading: true,
    };
    await render();
    await open();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain(
      "No integrations available",
    );
    expect(document.body.textContent).not.toContain("Connect an integration…");
    capabilities = {
      ...capabilities,
      integrationsLoading: false,
      integrationsError: new Error("Unavailable"),
    };
    await render();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not load integrations.",
    );
    expect(document.body.textContent).not.toContain(
      "No integrations available",
    );
    await act(async () => row("Retry").click());
    expect(capabilities.refetchIntegrations).toHaveBeenCalledOnce();
  });
  it("returns keyboard focus to the parent when dismissing the submenu", async () => {
    await render();
    await open();
    await key(row("Connect an integration…"), "Escape");
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
    expect(document.activeElement).toBe(row("Integrations"));
    expect(pathname).toBe("/home");
  });
});
