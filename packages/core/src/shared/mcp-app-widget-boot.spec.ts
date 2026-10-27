// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

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
});
