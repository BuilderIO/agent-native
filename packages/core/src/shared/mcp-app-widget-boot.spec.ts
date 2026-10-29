// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  embedTokenStorageKey,
  getMcpAppWidgetEmbedBootScriptBody,
  MCP_APP_WIDGET_EMBED_ATTRIBUTE,
  mcpChatBridgeStorageKey,
} from "./mcp-app-widget-embed.js";

function setTestUrl(url: string): void {
  const happyDom = (window as unknown as { happyDOM?: { setURL?: unknown } })
    .happyDOM;
  if (happyDom && typeof happyDom.setURL === "function") {
    happyDom.setURL(url);
    return;
  }
  window.history.replaceState(null, "", url);
}

function setParent(parent: Window): void {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
}

function runBootScript(
  basePath: string | undefined,
  workspaceRuntime: boolean,
): boolean {
  new Function(
    getMcpAppWidgetEmbedBootScriptBody(basePath, workspaceRuntime),
  )();
  const marked = document.documentElement.hasAttribute(
    MCP_APP_WIDGET_EMBED_ATTRIBUTE,
  );
  document.documentElement.removeAttribute(MCP_APP_WIDGET_EMBED_ATTRIBUTE);
  return marked;
}

function resetDocument(): void {
  setParent(window);
  setTestUrl("http://localhost:3000/");
  document.documentElement.removeAttribute(MCP_APP_WIDGET_EMBED_ATTRIBUTE);
  sessionStorage.clear();
  delete (window as Window & { __AGENT_NATIVE_EXTERNAL_EMBED?: unknown })
    .__AGENT_NATIVE_EXTERNAL_EMBED;
  delete (window as Window & { __AGENT_NATIVE_CONFIG__?: unknown })
    .__AGENT_NATIVE_CONFIG__;
  delete (window as Window & { __reactRouterContext?: unknown })
    .__reactRouterContext;
}

describe("MCP app widget embed boot script output", () => {
  afterEach(resetDocument);

  it("runs the workspace resolver in the minified first-paint script", async () => {
    const { transform } = await import("esbuild");
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl("http://localhost:3000/deck/reports");
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      workspaceRuntime: true,
      workspaceAppPath: "/",
      workspaceAppMountPaths: ["/deck"],
    };
    (
      window as Window & { __AGENT_NATIVE_EXTERNAL_EMBED?: unknown }
    ).__AGENT_NATIVE_EXTERNAL_EMBED = { target: "/deck/reports" };
    sessionStorage.setItem(embedTokenStorageKey("/deck", true), "child-token");
    sessionStorage.setItem(
      mcpChatBridgeStorageKey("/deck", true),
      "child-token",
    );

    const script = getMcpAppWidgetEmbedBootScriptBody(undefined, true);
    const minified = await transform(script, { minify: true });
    new Function(minified.code)();

    expect(
      document.documentElement.hasAttribute(MCP_APP_WIDGET_EMBED_ATTRIBUTE),
    ).toBe(true);
  });

  it("reads bridge state only from the current workspace app mount", () => {
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl("http://localhost:3000/dispatch/home");
    sessionStorage.setItem(
      embedTokenStorageKey("/event-finder", true),
      "child-token",
    );
    sessionStorage.setItem(
      mcpChatBridgeStorageKey("/event-finder", true),
      "child-token",
    );

    expect(runBootScript("/dispatch", true)).toBe(false);

    setTestUrl("http://localhost:3000/event-finder/inbox");
    expect(runBootScript("/event-finder", true)).toBe(true);
  });

  it("resolves the workspace mount in the first-paint script after SSR", () => {
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl("http://localhost:3000/event-finder/inbox");
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      workspaceRuntime: true,
      workspaceAppPath: "/event-finder",
      workspaceAppMountPaths: ["/dispatch", "/event-finder"],
    };
    sessionStorage.setItem(
      embedTokenStorageKey("/event-finder", true),
      "child-token",
    );
    sessionStorage.setItem(
      mcpChatBridgeStorageKey("/event-finder", true),
      "child-token",
    );

    expect(runBootScript(undefined, true)).toBe(true);
  });

  it("uses a declared sibling mount before explicit root config", () => {
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl("http://localhost:3000/mail/inbox");
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      workspaceRuntime: true,
      workspaceAppPath: "/",
      workspaceAppMountPaths: ["/mail"],
    };
    sessionStorage.setItem(embedTokenStorageKey("/mail", true), "child-token");
    sessionStorage.setItem(
      mcpChatBridgeStorageKey("/mail", true),
      "child-token",
    );

    expect(runBootScript(undefined, true)).toBe(true);
  });

  it("uses a declared external target mount instead of an explicit root mount", () => {
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl("http://localhost:3000/event-finder/inbox");
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      workspaceRuntime: true,
      workspaceAppPath: "/",
      workspaceAppMountPaths: ["/event-finder"],
    };
    (
      window as Window & { __AGENT_NATIVE_EXTERNAL_EMBED?: unknown }
    ).__AGENT_NATIVE_EXTERNAL_EMBED = { target: "/event-finder/inbox" };
    sessionStorage.setItem(
      embedTokenStorageKey("/event-finder", true),
      "child-token",
    );
    sessionStorage.setItem(
      mcpChatBridgeStorageKey("/event-finder", true),
      "child-token",
    );

    expect(runBootScript(undefined, true)).toBe(true);
  });

  it("keeps an unmatched nested route on an explicit root mount", () => {
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl("http://localhost:3000/reports/detail");
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      workspaceRuntime: true,
      workspaceAppPath: "/",
    };
    (
      window as Window & { __AGENT_NATIVE_EXTERNAL_EMBED?: unknown }
    ).__AGENT_NATIVE_EXTERNAL_EMBED = { target: "/reports/detail" };
    sessionStorage.setItem(embedTokenStorageKey("", true), "root-token");
    sessionStorage.setItem(mcpChatBridgeStorageKey("", true), "root-token");

    expect(runBootScript(undefined, true)).toBe(true);
  });

  it("uses projected root config for first paint on an env-only root mount", () => {
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl("http://localhost:3000/reports/detail");
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      workspaceRuntime: true,
      explicitRootPath: true,
    };
    (
      window as Window & { __AGENT_NATIVE_EXTERNAL_EMBED?: unknown }
    ).__AGENT_NATIVE_EXTERNAL_EMBED = { target: "/reports/detail" };
    sessionStorage.setItem(embedTokenStorageKey("", true), "root-token");
    sessionStorage.setItem(mcpChatBridgeStorageKey("", true), "root-token");

    expect(runBootScript(undefined, true)).toBe(true);
  });

  it("uses explicit embed signals when the workspace target has no declared mount", () => {
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl(
      "http://localhost:3000/reports/detail?__an_embed_token=child-token&__an_mcp_chat_bridge=1",
    );
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: unknown }
    ).__AGENT_NATIVE_CONFIG__ = {
      workspaceRuntime: true,
      workspaceAppMountPaths: ["/mail"],
    };
    (
      window as Window & { __AGENT_NATIVE_EXTERNAL_EMBED?: unknown }
    ).__AGENT_NATIVE_EXTERNAL_EMBED = { target: "/reports/detail" };
    const getItem = vi.spyOn(sessionStorage, "getItem");

    try {
      expect(runBootScript(undefined, true)).toBe(true);
      expect(getItem).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
    }
  });

  it("recognizes a transplanted active bridge before sessionStorage is written", () => {
    setParent({ postMessage() {} } as unknown as Window);
    setTestUrl("http://localhost:3000/event-finder/inbox");
    (
      window as Window & { __AGENT_NATIVE_EXTERNAL_EMBED?: unknown }
    ).__AGENT_NATIVE_EXTERNAL_EMBED = {
      target: "/event-finder/inbox",
      token: "child-token",
      chatBridgeActive: true,
    };

    expect(runBootScript("/event-finder", true)).toBe(true);
  });
});
