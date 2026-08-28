// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentNativeI18nProvider } from "../i18n.js";
import { McpAccessSettings } from "./McpAccessSettings.js";

describe("McpAccessSettings localization", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
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

    const connectLink = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent?.includes("Abrir página completa de conexión"),
    );
    expect(connectLink?.getAttribute("href")).toContain("locale=es-ES");
  });
});
