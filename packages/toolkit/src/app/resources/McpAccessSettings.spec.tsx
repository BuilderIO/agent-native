// @vitest-environment happy-dom
// oracle-change: MCP setup now opens client detail pages from a list instead of switching tabs.
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { queryByRole } from "@testing-library/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  McpAccessSettings,
  type McpAccessSettingsProps,
} from "./McpAccessSettings.js";

const statusQuery = vi.hoisted(() => ({
  data: {
    connections: [
      "claude",
      "chatgpt",
      "cursor",
      "vscode",
      "claude-code",
      "codex",
      "grok",
      "other",
    ].map((client) => ({
      client,
      status: "disconnected",
      lastUsedAt: null as number | null,
    })),
  },
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/use-action", () => ({
  useActionQuery: () => statusQuery,
}));

const IDENTITY = {
  serverName: "beta-agent-native-content",
  appName: "Content",
  appUrl: "https://beta.content.agent-native.com",
  mcpUrl: "https://beta.content.agent-native.com/mcp",
  environment: "beta",
  connect: true,
};
function stubFetch(body: unknown = IDENTITY, ok = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith("/mcp/connect/identity")
      ? { ok, status: ok ? 200 : 500, json: async () => body }
      : { ok: false, status: 404 },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("MCP client setup", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    stubFetch();
    statusQuery.isError = false;
    statusQuery.isPending = false;
    statusQuery.refetch.mockClear();
    statusQuery.data.connections.forEach((row) => {
      row.status = "disconnected";
      row.lastUsedAt = null;
    });
    window.history.replaceState({}, "", "/settings/mcp");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(props: McpAccessSettingsProps = {}, locale = "en-US") {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          initialLocale={locale}
          initialPreference={locale}
          persistPreference={false}
        >
          <McpAccessSettings hideHeader {...props} />
        </AgentNativeI18nProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(container.querySelector("[aria-busy=true]")).toBeNull(),
    );
  }
  function link(name: string) {
    return (
      queryByRole<HTMLAnchorElement>(container, "link", {
        name,
        exact: true,
      }) ?? undefined
    );
  }
  async function open(name: string) {
    const target = link(name);
    expect(target).toBeDefined();
    await act(async () => target?.click());
  }

  it("shows server-backed connection status and activity", async () => {
    const row = statusQuery.data.connections.find(
      (row) => row.client === "codex",
    );
    if (!row) throw new Error("Missing Codex fixture");
    row.status = "connected";
    row.lastUsedAt = 1_800_000_000_000;
    await render({ guideId: "codex" });
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).toContain("Last used");
    expect(container.textContent).not.toContain("No activity recorded");
    expect(
      queryByRole<HTMLButtonElement>(container, "button", {
        name: "Copy prompt",
        exact: true,
      })?.disabled,
    ).toBe(false);
  });

  it("shows connection status directly in the client list", async () => {
    statusQuery.data.connections[0].status = "connected";
    statusQuery.data.connections[0].lastUsedAt = 1_800_000_000_000;
    await render();
    const claude = queryByRole<HTMLAnchorElement>(container, "link", {
      name: /^Claude Last used/,
    });
    expect(claude?.textContent).toContain("Connected");
    expect(claude?.textContent).toContain("Last used");
    expect(link("ChatGPT")).toBeDefined();
  });

  it("reports a failed check instead of showing stale Connected metadata", async () => {
    statusQuery.data.connections[0].status = "connected";
    statusQuery.isError = true;
    await render({ guideId: "claude" });
    expect(container.textContent).toContain("Status unavailable");
    expect(container.textContent).not.toContain("Connected");
    const retry = queryByRole<HTMLButtonElement>(container, "button", {
      name: "Try again",
    });
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(statusQuery.refetch).toHaveBeenCalledOnce();
  });

  it("keeps unverifiable older credentials distinct from disconnected", async () => {
    statusQuery.data.connections[0].status = "unknown";
    await render({ guideId: "claude" });
    expect(container.textContent).toContain("Status unavailable");
    expect(container.textContent).toContain("Older credentials");
    expect(container.textContent).not.toContain("Not connected");
  });

  it("starts with a client list, a useful outcome, and no configuration form", async () => {
    await render();
    expect(container.textContent).toContain(
      "Use Claude, ChatGPT, or another AI app to read and update data in Content.",
    );
    for (const name of [
      "Claude",
      "ChatGPT",
      "Cursor",
      "VS Code",
      "Claude Code",
      "Codex CLI",
      "Grok",
      "Other",
    ])
      expect(link(name)).toBeDefined();
    expect(container.querySelector("[role=combobox]")).toBeNull();
    expect(container.textContent).not.toContain("MCP server URL");
    expect(container.textContent).not.toContain("Generate a static token");
    expect(container.querySelectorAll("img")).toHaveLength(7);
    expect(link("Cursor")?.querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(link("Grok")?.querySelector("img")?.getAttribute("src")).toMatch(
      /^data:image\/svg\+xml;base64,/,
    );
  });
  it("opens the chosen client while preserving unrelated query parameters", async () => {
    window.history.replaceState({}, "", "/settings/mcp?section=access");
    await render();
    await open("Cursor");
    expect(window.location.search).toContain("guide=cursor");
    expect(window.location.search).toContain("section=access");
    const install = link("Add to Cursor");
    expect(install?.target).toBe("_blank");
    const url = new URL(install?.href ?? "");
    expect(url.origin + url.pathname).toBe("https://cursor.com/install-mcp");
    expect(url.searchParams.get("name")).toBe(IDENTITY.serverName);
    expect(JSON.parse(atob(url.searchParams.get("config") ?? ""))).toEqual({
      url: IDENTITY.mcpUrl,
    });
    expect(container.textContent).not.toContain(IDENTITY.mcpUrl);
    expect(container.textContent).not.toContain("mcp.json");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent === "Manual setup")
        ?.click(),
    );
    expect(container.textContent).toContain(IDENTITY.mcpUrl);
    expect(container.textContent).toContain("mcp.json");
    expect(container.textContent).toContain("approve the MCP scopes");
  });
  it("exposes real hrefs and preserves modified clicks", async () => {
    const select = vi.fn();
    await render({
      guideId: null,
      onSelectGuide: select,
      guideHref: (id) => `/settings/mcp/${id}`,
    });
    const cursor = link("Cursor");
    expect(cursor?.getAttribute("href")).toBe("/settings/mcp/cursor");
    await act(async () =>
      cursor?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      ),
    );
    expect(select).not.toHaveBeenCalled();
    await act(async () =>
      cursor?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
    expect(select).toHaveBeenCalledWith("cursor");
  });
  it("restores the chosen client on browser navigation", async () => {
    await render();
    await open("Cursor");
    await act(async () => {
      window.history.replaceState({}, "", "/settings/mcp?guide=grok");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(container.textContent).toContain("grok.com/connectors");
    expect(link("Add to Cursor")).toBeUndefined();
    await act(async () => {
      window.history.replaceState({}, "", "/settings/mcp");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(link("Codex CLI")).toBeDefined();
    expect(container.textContent).not.toContain("MCP server URL");
  });
  it("honors a direct CLI handoff and uses the server identity in the command", async () => {
    window.history.replaceState({}, "", "/settings/mcp?guide=codex");
    await render();
    expect(container.textContent).toContain(
      `codex mcp add ${IDENTITY.serverName} --url ${IDENTITY.mcpUrl}`,
    );
    expect(container.textContent).toContain(
      `codex mcp login ${IDENTITY.serverName}`,
    );
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).not.toContain("Try it in Codex.");
  });
  it("opens the web client from its setup stage and copies the URL separately with failure feedback", async () => {
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValue(undefined);
    await render({ guideId: "chatgpt" });
    const action = link("Open ChatGPT");
    expect(action?.href).toBe("https://chatgpt.com/plugins");
    expect(action?.target).toBe("_blank");
    const copy = queryByRole<HTMLButtonElement>(container, "button", {
      name: "Copy URL",
      exact: true,
    });
    expect(copy).not.toBeNull();
    await act(async () => copy?.click());
    expect(write).toHaveBeenCalledWith(IDENTITY.mcpUrl);
    expect(container.textContent).toContain("Copy failed");
    await act(async () => copy?.click());
    expect(container.textContent).not.toContain("Copy failed");
    expect(
      [...container.querySelectorAll("[role=status]")].some(
        (item) => item.textContent === "Copied",
      ),
    ).toBe(true);
  });
  it("places the install action in the opening setup stage", async () => {
    await render({ guideId: "cursor" });
    const install = link("Add to Cursor");
    expect(install?.closest("li")?.textContent).toContain("Add the MCP server");
    expect(
      container.querySelectorAll('a[href^="https://cursor.com/install-mcp"]'),
    ).toHaveLength(1);
    expect(
      queryByRole<HTMLButtonElement>(container, "button", {
        name: "Copy prompt",
        exact: true,
      })?.disabled,
    ).toBe(false);
  });
  it("localizes the client list and detail controls", async () => {
    await render({}, "es-ES");
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "leer y actualizar datos en Content",
      ),
    );
    await open("Claude");
    expect(container.textContent).toContain("herramientas de Agent-Native");
    expect(container.textContent).toContain("URL del servidor");
    expect(container.textContent).toContain(
      "En Claude, ve a Customize → Connectors.",
    );
    expect(container.textContent).not.toContain("MCP server URL");
  });
  it("keeps the VS Code installation transport and environment-specific server name", async () => {
    await render({ guideId: "vscode" });
    const url = link("Add to VS Code")?.getAttribute("href") ?? "";
    expect(url.startsWith("vscode:mcp/install?")).toBe(true);
    expect(link("Add to VS Code")?.target).toBe("");
    expect(JSON.parse(decodeURIComponent(url.split("?")[1]))).toEqual({
      name: IDENTITY.serverName,
      type: "http",
      url: IDENTITY.mcpUrl,
    });
  });
  it("keeps manual JSON readable and token fallback behind advanced disclosure", async () => {
    await render({ guideId: "other" });
    expect(container.querySelector("pre")?.textContent).toContain(
      '"mcpServers"',
    );
    expect(container.textContent).not.toContain("Generate a static token");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent === "Advanced options")
        ?.click(),
    );
    const target = link("Open full connect page")?.getAttribute("href");
    expect(target).toContain("guide=other");
    expect(target).toContain("locale=en-US");
    expect(container.textContent).toContain("Generate a static token");
  });
  it("does not offer setup routes when OAuth and token routes are unavailable", async () => {
    stubFetch({ ...IDENTITY, connect: false });
    await render();
    const field = queryByRole<HTMLInputElement>(container, "textbox", {
      name: "MCP server URL",
      exact: true,
    });
    expect(field?.value).toBe(IDENTITY.mcpUrl);
    expect(field?.readOnly).toBe(true);
    expect(link("Claude")).toBeUndefined();
    expect(link("Open full connect page")).toBeUndefined();
  });
  it("offers retry after a failed identity read without guessing the server URL", async () => {
    stubFetch(undefined, false);
    await render();
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Couldn't load this app's connection details.",
    );
    expect(container.textContent).not.toContain(IDENTITY.mcpUrl);
    const fetch = stubFetch();
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent === "Try again")
        ?.click(),
    );
    await vi.waitFor(() => expect(link("Claude")).toBeDefined());
    expect(fetch).toHaveBeenCalled();
  });
  it("announces new tabs and desktop launches without adding navigation arrows to copy actions", async () => {
    await render({ guideId: "vscode" });
    const install = link("Add to VS Code");
    expect(install?.target).toBe("");
    expect(
      document.getElementById(install?.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Opens the desktop app");
    expect(
      install?.querySelector(".tabler-icon-device-desktop"),
    ).not.toBeNull();
    expect(install?.querySelector(".tabler-icon-external-link")).toBeNull();

    const docs = link("Setup guide");
    expect(docs?.target).toBe("_blank");
    expect(
      document.getElementById(docs?.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Opens in a new tab");
    expect(docs?.querySelector(".tabler-icon-external-link")).not.toBeNull();

    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Manual setup")
        ?.click(),
    );
    const insiders = link("Add to VS Code Insiders");
    expect(insiders?.target).toBe("");
    expect(
      document.getElementById(insiders?.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Opens the desktop app");

    await render({ guideId: "cursor" });
    const cursor = link("Add to Cursor");
    expect(cursor?.target).toBe("_blank");
    expect(
      document.getElementById(cursor?.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Opens in a new tab");
    expect(cursor?.querySelector(".tabler-icon-external-link")).not.toBeNull();

    await render({ guideId: "codex" });
    const copy = queryByRole(container, "button", {
      name: "Copy command",
      exact: true,
    });
    expect(copy).not.toBeNull();
    expect(copy?.querySelector("svg")).toBeNull();
    expect(copy?.hasAttribute("aria-describedby")).toBe(false);
  });

  it("renders an impersonal loading shell without a browser", () => {
    const browserWindow = window;
    try {
      vi.stubGlobal("window", undefined);
      expect(() =>
        renderToString(
          <AgentNativeI18nProvider
            initialLocale="en-US"
            persistPreference={false}
          >
            <McpAccessSettings />
          </AgentNativeI18nProvider>,
        ),
      ).not.toThrow();
    } finally {
      vi.stubGlobal("window", browserWindow);
    }
  });
});
