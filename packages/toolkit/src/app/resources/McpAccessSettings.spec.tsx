// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpAccessSettings } from "./McpAccessSettings.js";

const IDENTITY = {
  serverName: "beta-agent-native-content",
  appName: "Content",
  appUrl: "https://beta.content.agent-native.com",
  mcpUrl: "https://beta.content.agent-native.com/mcp",
  environment: "beta",
  connect: true,
};

function stubFetch(identity: { ok: boolean; body?: unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/mcp/connect/identity")) {
      return identity.ok
        ? { ok: true, status: 200, json: async () => identity.body }
        : { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: false, status: 404 };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function waitForGuides(container: HTMLElement) {
  await vi.waitFor(() =>
    expect(container.querySelector("#mcp-guide-tab-claude")).not.toBeNull(),
  );
}

// Radix tabs activate on mousedown, not click.
function selectTab(tab: HTMLButtonElement | null) {
  tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
}

describe("McpAccessSettings localization", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    stubFetch({ ok: true, body: IDENTITY });
    window.history.replaceState({}, "", "/settings/mcp");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders the MCP chrome in the selected locale", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="es-ES"
          initialPreference="es-ES"
          persistPreference={false}
        >
          <McpAccessSettings appName="Mail" />
        </AgentNativeI18nProvider>,
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Conecta esta app con Claude, ChatGPT, Cursor, Codex u otro host MCP.",
      ),
    );

    expect(container.textContent).toContain(
      "Conecta esta app con Claude, ChatGPT, Cursor, Codex u otro host MCP.",
    );
    expect(container.textContent).toContain("URL del servidor MCP");
    expect(container.textContent).toContain("Conectar un host de IA");
    expect(container.textContent).not.toContain("MCP server URL");
    expect(container.textContent).toContain("Abre Customize → Connectors");

    const claudeTab = container.querySelector<HTMLButtonElement>(
      "#mcp-guide-tab-claude",
    );
    expect(claudeTab).not.toBeNull();
    expect(claudeTab?.getAttribute("aria-selected")).toBe("true");

    const connectLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent?.includes("Abrir página completa de conexión"),
    );
    expect(connectLink?.getAttribute("href")).toContain("locale=es-ES");
  });

  it("uses the app title metadata when no app name is provided", async () => {
    const meta = document.createElement("meta");
    meta.name = "apple-mobile-web-app-title";
    meta.content = "Mail";
    document.head.appendChild(meta);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <McpAccessSettings />
        </AgentNativeI18nProvider>,
      );
    });

    try {
      await waitForGuides(container);
      const claudeTab = container.querySelector<HTMLButtonElement>(
        "#mcp-guide-tab-claude",
      );
      expect(claudeTab).not.toBeNull();
      await act(async () => selectTab(claudeTab));
      expect(container.textContent).toContain("name it Mail");
    } finally {
      meta.remove();
    }
  });

  it("selects the guide requested by the integrations handoff", async () => {
    window.history.replaceState({}, "", "/settings/mcp?guide=grok");

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <McpAccessSettings appName="Content" />
        </AgentNativeI18nProvider>,
      );
    });
    await waitForGuides(container);

    expect(
      container
        .querySelector("#mcp-guide-tab-grok")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.textContent).toContain("grok.com/connectors");
  });

  it("synchronizes the guide after browser navigation", async () => {
    window.history.replaceState({}, "", "/settings/mcp?guide=grok");

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <McpAccessSettings appName="Content" />
        </AgentNativeI18nProvider>,
      );
    });
    await waitForGuides(container);

    await act(async () => {
      window.history.pushState({}, "", "/settings/mcp?guide=cursor");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(
      container
        .querySelector("#mcp-guide-tab-cursor")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps a selected guide in the URL and restores it on navigation", async () => {
    window.history.replaceState(
      {},
      "",
      "/settings/mcp?guide=grok&section=access",
    );

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <McpAccessSettings appName="Content" />
        </AgentNativeI18nProvider>,
      );
    });
    await waitForGuides(container);

    await act(async () => {
      selectTab(
        container.querySelector<HTMLButtonElement>("#mcp-guide-tab-cursor"),
      );
    });
    expect(new URLSearchParams(window.location.search).get("guide")).toBe(
      "cursor",
    );
    expect(new URLSearchParams(window.location.search).get("section")).toBe(
      "access",
    );

    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      container
        .querySelector("#mcp-guide-tab-cursor")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("names the server and builds install links from the app's connect identity", async () => {
    window.history.replaceState({}, "", "/settings/mcp?guide=claude-code");

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <McpAccessSettings appName="Content" />
        </AgentNativeI18nProvider>,
      );
    });
    await waitForGuides(container);

    expect(container.textContent).toContain(
      "claude mcp add --transport http beta-agent-native-content https://beta.content.agent-native.com/mcp",
    );

    await act(async () => {
      selectTab(
        container.querySelector<HTMLButtonElement>("#mcp-guide-tab-cursor"),
      );
    });
    const cursorLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent?.includes("Add to Cursor"),
    );
    const cursorHref = new URL(cursorLink?.getAttribute("href") ?? "");
    expect(cursorHref.origin + cursorHref.pathname).toBe(
      "https://cursor.com/install-mcp",
    );
    expect(cursorHref.searchParams.get("name")).toBe(
      "beta-agent-native-content",
    );
    expect(
      JSON.parse(atob(cursorHref.searchParams.get("config") ?? "")),
    ).toEqual({ url: "https://beta.content.agent-native.com/mcp" });
    expect(cursorLink?.getAttribute("target")).toBe("_blank");

    await act(async () => {
      selectTab(
        container.querySelector<HTMLButtonElement>("#mcp-guide-tab-vscode"),
      );
    });
    const vscodeHrefs = Array.from(container.querySelectorAll("a"))
      .filter((link) => link.textContent?.startsWith("Add to VS Code"))
      .map((link) => ({
        href: link.getAttribute("href") ?? "",
        target: link.getAttribute("target"),
      }));
    expect(vscodeHrefs.map(({ href }) => href.split("?")[0])).toEqual([
      "vscode:mcp/install",
      "vscode-insiders:mcp/install",
    ]);
    expect(vscodeHrefs.every(({ target }) => target === null)).toBe(true);
    expect(
      JSON.parse(decodeURIComponent(vscodeHrefs[0].href.split("?")[1])),
    ).toEqual({
      name: "beta-agent-native-content",
      type: "http",
      url: "https://beta.content.agent-native.com/mcp",
    });
  });

  it("shows only the MCP URL when the server has no connect routes", async () => {
    stubFetch({ ok: true, body: { ...IDENTITY, connect: false } });
    window.history.replaceState({}, "", "/settings/mcp?guide=cursor");

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <McpAccessSettings appName="Content" />
        </AgentNativeI18nProvider>,
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(IDENTITY.mcpUrl),
    );

    expect(container.querySelector("#mcp-guide-tab-claude")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("a")).filter(
        (link) =>
          link.textContent?.includes("Add to Cursor") ||
          link.getAttribute("href")?.includes("/mcp/connect"),
      ),
    ).toEqual([]);
  });

  it("shows a retryable error instead of guessing a server name when the identity fails", async () => {
    stubFetch({ ok: false });

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <McpAccessSettings appName="Content" />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Couldn't load this app's connection details.",
      ),
    );
    expect(container.querySelector("#mcp-guide-tab-claude")).toBeNull();

    const fetchMock = stubFetch({ ok: true, body: IDENTITY });
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    await act(async () => retry?.click());
    await waitForGuides(container);
    expect(fetchMock).toHaveBeenCalled();
    expect(container.textContent).toContain(
      "https://beta.content.agent-native.com/mcp",
    );
  });

  it("renders the default guide without a browser during SSR", () => {
    const browserWindow = window;
    vi.stubGlobal("window", undefined);

    try {
      expect(() =>
        renderToString(
          <AgentNativeI18nProvider
            initialLocale="en-US"
            initialPreference="en-US"
            persistPreference={false}
          >
            <McpAccessSettings appName="Content" />
          </AgentNativeI18nProvider>,
        ),
      ).not.toThrow();
    } finally {
      vi.stubGlobal("window", browserWindow);
    }
  });
});
