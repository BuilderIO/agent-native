// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentNativeI18nProvider } from "../i18n.js";
import { McpAccessSettings } from "./McpAccessSettings.js";

describe("McpAccessSettings localization", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
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
      const claudeTab = container.querySelector<HTMLButtonElement>(
        "#mcp-guide-tab-claude",
      );
      expect(claudeTab).not.toBeNull();
      await act(async () => claudeTab?.click());
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

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("#mcp-guide-tab-cursor")
        ?.click();
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
