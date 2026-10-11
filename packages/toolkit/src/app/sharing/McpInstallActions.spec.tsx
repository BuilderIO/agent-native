// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpInstallActions } from "./McpInstallActions.js";

const IDENTITY = {
  serverName: "beta-agent-native-content",
  appName: "Content",
  appUrl: "https://beta.content.agent-native.com",
  mcpUrl: "https://beta.content.agent-native.com/mcp",
  environment: "beta",
  connect: true,
};

function stubIdentity(ok: boolean, identity = IDENTITY) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/mcp/connect/identity") && ok) {
      return { ok: true, status: 200, json: async () => identity };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("McpInstallActions", () => {
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

  async function render(
    props: Partial<Parameters<typeof McpInstallActions>[0]> = {},
    locale: "en-US" | "es-ES" = "en-US",
  ) {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale={locale}
          initialPreference={locale}
          persistPreference={false}
        >
          <McpInstallActions
            heading="Connect Content"
            otherClients={{
              label: "Other agents",
              href: "/settings/mcp",
            }}
            {...props}
          />
        </AgentNativeI18nProvider>,
      );
    });
  }

  function link(text: string) {
    return Array.from(container.querySelectorAll("a")).find((anchor) =>
      anchor.textContent?.includes(text),
    );
  }

  it("installs this app's server under the name and URL the server reports", async () => {
    stubIdentity(true);
    const onInstall = vi.fn();
    await render({ onInstall });
    await vi.waitFor(() => expect(link("Add to Cursor")).toBeDefined());

    const cursor = new URL(link("Add to Cursor")!.getAttribute("href")!);
    expect(cursor.origin + cursor.pathname).toBe(
      "https://cursor.com/install-mcp",
    );
    expect(cursor.searchParams.get("name")).toBe("beta-agent-native-content");
    expect(JSON.parse(atob(cursor.searchParams.get("config")!))).toEqual({
      url: "https://beta.content.agent-native.com/mcp",
    });
    expect(link("Add to Cursor")!.getAttribute("target")).toBe("_blank");

    const vscode = link("Add to VS Code")!;
    const [scheme, query] = vscode.getAttribute("href")!.split("?");
    expect(scheme).toBe("vscode:mcp/install");
    expect(JSON.parse(decodeURIComponent(query!))).toEqual({
      name: "beta-agent-native-content",
      type: "http",
      url: "https://beta.content.agent-native.com/mcp",
    });
    expect(vscode.hasAttribute("target")).toBe(false);
    expect(link("VS Code Insiders")).toBeUndefined();

    vscode.addEventListener("click", (event) => event.preventDefault());
    await act(async () => vscode.click());
    expect(onInstall).toHaveBeenCalledWith("vscode");
  });

  it("uses the shared guide labels in the reader's locale", async () => {
    stubIdentity(true);
    await render({}, "es-ES");
    await vi.waitFor(() => expect(link("Añadir a Cursor")).toBeDefined());
    expect(link("Añadir a VS Code")).toBeDefined();
  });

  it("routes the other-agents link in the app", async () => {
    stubIdentity(true);
    const onNavigate = vi.fn();
    await render({
      otherClients: {
        label: "Other agents",
        href: "/settings/mcp",
        onNavigate,
      },
    });
    const other = link("Other agents")!;
    expect(other.getAttribute("href")).toBe("/settings/mcp");
    await act(async () => other.click());
    expect(onNavigate).toHaveBeenCalledWith("/settings/mcp");
  });

  it("offers only the other-agents path when the server has no connect routes", async () => {
    stubIdentity(true, { ...IDENTITY, connect: false });
    await render();
    await vi.waitFor(() =>
      expect(container.querySelector('[aria-busy="true"]')).toBeNull(),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(link("Add to Cursor")).toBeUndefined();
    expect(link("Add to VS Code")).toBeUndefined();
    expect(link("Other agents")).toBeDefined();
  });

  it("shows a retryable error and keeps the other-agents path when the identity fails", async () => {
    stubIdentity(false);
    await render();
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Couldn't load this app's connection details.",
      ),
    );
    expect(link("Add to Cursor")).toBeUndefined();
    expect(link("Other agents")).toBeDefined();

    stubIdentity(true);
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    await act(async () => retry!.click());
    await vi.waitFor(() => expect(link("Add to Cursor")).toBeDefined());
  });
});
