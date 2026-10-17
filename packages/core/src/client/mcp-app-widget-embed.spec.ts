// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMBED_TOKEN_STORAGE_KEY,
  getMcpAppWidgetEmbedBootScriptBody,
  MCP_APP_WIDGET_EMBED_ATTRIBUTE,
  MCP_CHAT_BRIDGE_STORAGE_KEY,
} from "../shared/mcp-app-widget-embed.js";
import { _resetEmbedAuthForTests } from "./embed-auth.js";
import {
  _resetMcpAppHostForTests,
  isMcpAppWidgetEmbed,
  useIsMcpAppWidgetEmbed,
} from "./mcp-app-host.js";

const FLAG = "__an_mcp_chat_bridge=1";
const TOKEN = "__an_embed_token=signed-token";
const DIRECTORY_CAPABILITY_TOKEN = `${Buffer.from(
  JSON.stringify({
    scope:
      "capability:mcp-directory-widget-read:" +
      encodeURIComponent(JSON.stringify({ version: 1 })),
  }),
).toString("base64url")}.signature`;

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

function hostWindow(): Window {
  return { postMessage: vi.fn() } as unknown as Window;
}

function resetDocument(): void {
  setParent(window);
  setTestUrl("http://localhost:3000/");
  sessionStorage.clear();
  _resetMcpAppHostForTests();
  _resetEmbedAuthForTests();
}

function enterWidgetFrame(search: string): void {
  resetDocument();
  setParent(hostWindow());
  setTestUrl(`/design/d1?${search}`);
}

function denyStorage(): () => void {
  const blocked = () => {
    throw new Error("blocked");
  };
  const spies = [
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked),
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked),
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked),
  ];
  return () => spies.forEach((spy) => spy.mockRestore());
}

function runBootScript(): boolean {
  new Function(getMcpAppWidgetEmbedBootScriptBody())();
  const marked = document.documentElement.hasAttribute(
    MCP_APP_WIDGET_EMBED_ATTRIBUTE,
  );
  document.documentElement.removeAttribute(MCP_APP_WIDGET_EMBED_ATTRIBUTE);
  return marked;
}

describe("MCP app widget detection at the shared boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  function renderProbe(snapshots: boolean[], key = "probe"): void {
    function Probe() {
      snapshots.push(useIsMcpAppWidgetEmbed());
      return null;
    }
    act(() => {
      root.render(React.createElement(Probe, { key }));
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetDocument();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    resetDocument();
  });

  it.each([620, 1100])(
    "is a widget on the very first render at a %ipx wide pane",
    (width) => {
      vi.stubGlobal("innerWidth", width);
      enterWidgetFrame(`embedded=1&${TOKEN}&${FLAG}`);
      const snapshots: boolean[] = [];

      renderProbe(snapshots);

      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots.every(Boolean)).toBe(true);
      expect(
        document.documentElement.getAttribute(MCP_APP_WIDGET_EMBED_ATTRIBUTE),
      ).toBe("1");
    },
  );

  it.each([
    ["sessionStorage works", () => () => {}],
    ["sessionStorage is denied", denyStorage],
  ])(
    "stays a widget after a client navigation drops every embed param when %s",
    (_label, prepare) => {
      enterWidgetFrame(`embedded=1&${TOKEN}&${FLAG}`);
      const restore = prepare();
      try {
        const snapshots: boolean[] = [];
        renderProbe(snapshots);
        expect(snapshots.at(-1)).toBe(true);

        setTestUrl("/design/d2");
        renderProbe(snapshots, "after-navigation");

        expect(snapshots.every(Boolean)).toBe(true);
        expect(isMcpAppWidgetEmbed()).toBe(true);
        expect(
          document.documentElement.getAttribute(MCP_APP_WIDGET_EMBED_ATTRIBUTE),
        ).toBe("1");
      } finally {
        restore();
      }
    },
  );

  it("stays a widget when the chat bridge de-enrolls because the token swapped", () => {
    enterWidgetFrame(`embedded=1&${TOKEN}&${FLAG}`);
    expect(isMcpAppWidgetEmbed()).toBe(true);

    setTestUrl("/design/d1?embedded=1&__an_embed_token=other-token");

    expect(isMcpAppWidgetEmbed()).toBe(true);
  });

  it("tells a widget from other embeds by the chat-bridge flag", () => {
    enterWidgetFrame(`embedded=1&${TOKEN}`);
    expect(isMcpAppWidgetEmbed()).toBe(false);
    expect(
      document.documentElement.hasAttribute(MCP_APP_WIDGET_EMBED_ATTRIBUTE),
    ).toBe(false);

    enterWidgetFrame(`embedded=1&${TOKEN}&${FLAG}`);
    expect(isMcpAppWidgetEmbed()).toBe(true);

    enterWidgetFrame(FLAG);
    expect(isMcpAppWidgetEmbed()).toBe(false);

    resetDocument();
    setTestUrl(`/design/d1?embedded=1&${TOKEN}&${FLAG}`);
    expect(isMcpAppWidgetEmbed()).toBe(false);
  });

  it("recognizes a directory widget capability without the flag, even once the params are gone", () => {
    enterWidgetFrame(
      `embedded=1&__an_embed_token=${DIRECTORY_CAPABILITY_TOKEN}`,
    );
    expect(isMcpAppWidgetEmbed()).toBe(true);

    resetDocument();
    setParent(hostWindow());
    sessionStorage.setItem(EMBED_TOKEN_STORAGE_KEY, DIRECTORY_CAPABILITY_TOKEN);
    setTestUrl("/design/d1");
    expect(isMcpAppWidgetEmbed()).toBe(true);
  });

  it("re-renders a subscriber that read false before the document became a widget", async () => {
    enterWidgetFrame(`embedded=1&${TOKEN}`);
    const snapshots: boolean[] = [];
    renderProbe(snapshots);
    expect(snapshots.at(-1)).toBe(false);

    setTestUrl(`/design/d1?embedded=1&${TOKEN}&${FLAG}`);
    await act(async () => {
      expect(isMcpAppWidgetEmbed()).toBe(true);
      await Promise.resolve();
    });

    expect(snapshots.at(-1)).toBe(true);
  });

  describe("first-paint boot script", () => {
    type Case = {
      name: string;
      childFrame: boolean;
      search: string;
      stored?: Record<string, string>;
      denyStorage?: boolean;
      widget: boolean;
    };
    const cases: Case[] = [
      {
        name: "flag and token in the URL",
        childFrame: true,
        search: `embedded=1&${TOKEN}&${FLAG}`,
        widget: true,
      },
      {
        name: "flag as the string true",
        childFrame: true,
        search: `embedded=1&${TOKEN}&__an_mcp_chat_bridge=true`,
        widget: true,
      },
      {
        name: "flag with embedded=1 but no token",
        childFrame: true,
        search: `embedded=1&${FLAG}`,
        widget: true,
      },
      {
        name: "flag and token with storage denied",
        childFrame: true,
        search: `embedded=1&${TOKEN}&${FLAG}`,
        denyStorage: true,
        widget: true,
      },
      {
        name: "no params, token and bridge scope stored",
        childFrame: true,
        search: "",
        stored: {
          [EMBED_TOKEN_STORAGE_KEY]: "signed-token",
          [MCP_CHAT_BRIDGE_STORAGE_KEY]: "signed-token",
        },
        widget: true,
      },
      {
        name: "embedded token without the flag",
        childFrame: true,
        search: `embedded=1&${TOKEN}`,
        widget: false,
      },
      {
        name: "flag without any embed credential",
        childFrame: true,
        search: FLAG,
        widget: false,
      },
      {
        name: "stored bridge scope of a different token",
        childFrame: true,
        search: "",
        stored: {
          [EMBED_TOKEN_STORAGE_KEY]: "signed-token",
          [MCP_CHAT_BRIDGE_STORAGE_KEY]: "old-token",
        },
        widget: false,
      },
      {
        name: "top-level document",
        childFrame: false,
        search: `embedded=1&${TOKEN}&${FLAG}`,
        widget: false,
      },
    ];

    it.each(cases)(
      "agrees with isMcpAppWidgetEmbed: $name",
      ({ childFrame, search, stored, denyStorage: deny, widget }) => {
        resetDocument();
        if (childFrame) setParent(hostWindow());
        setTestUrl(`/design/d1?${search}`);
        for (const [key, value] of Object.entries(stored ?? {})) {
          sessionStorage.setItem(key, value);
        }
        const restore = deny ? denyStorage() : () => {};
        try {
          expect(runBootScript()).toBe(widget);
          expect(isMcpAppWidgetEmbed()).toBe(widget);
        } finally {
          restore();
        }
      },
    );

    it("makes the first render a widget when the script ran before React", () => {
      resetDocument();
      setParent(hostWindow());
      setTestUrl(`/design/d1?embedded=1&${TOKEN}&${FLAG}`);
      new Function(getMcpAppWidgetEmbedBootScriptBody())();
      const snapshots: boolean[] = [];

      renderProbe(snapshots);

      expect(snapshots.every(Boolean)).toBe(true);
    });
  });
});
