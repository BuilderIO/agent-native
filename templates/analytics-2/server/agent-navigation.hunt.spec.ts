import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tabId: "tab-1" as string | null,
  writes: [] as unknown[][],
}));

vi.mock(
  "../../../packages/core/dist/application-state/script-helpers.js",
  async (original) => ({
    ...(await original<object>()),
    resolveCurrentRequestStateTab: async () => ({
      tabId: state.tabId,
      unavailable: state.tabId === null,
    }),
    readAppState: async () => ({ view: "home" }),
    resolveSessionId: async () => "session-1",
  }),
);

vi.mock(
  "../../../packages/core/dist/application-state/store.js",
  async (original) => ({
    ...(await original<object>()),
    appStatePut: async (...args: unknown[]) => {
      state.writes.push(args);
    },
  }),
);

import { showAgentResource } from "./agent-navigation";

const agentContext = { caller: "tool", userEmail: "qa-fleet@builder.io" };

describe("showAgentResource reports why navigation did not happen", () => {
  beforeEach(() => {
    state.tabId = "tab-1";
    state.writes = [];
  });

  it("reports kept, not a missing tab, when the agent did not ask to open the result", async () => {
    const result = await showAgentResource(
      agentContext as never,
      "project",
      "p-1",
    );
    expect(result).toEqual({ navigation: { status: "kept" } });
    expect(state.writes).toEqual([]);
  });

  it("reports kept even when no browser tab is open and the agent did not ask to open", async () => {
    state.tabId = null;
    const result = await showAgentResource(
      agentContext as never,
      "thread",
      "t-1",
    );
    expect(result).toEqual({ navigation: { status: "kept" } });
  });

  it("requests navigation when the agent passes intent open with a tab open", async () => {
    const result = await showAgentResource(
      agentContext as never,
      "project",
      "p-1",
      "open",
    );
    expect(result).toEqual({ navigation: { status: "requested" } });
    expect(state.writes).toHaveLength(1);
  });

  it("reports a missing browser tab only when open was requested and no tab exists", async () => {
    state.tabId = null;
    const result = await showAgentResource(
      agentContext as never,
      "project",
      "p-1",
      "open",
    );
    expect(result).toEqual({
      navigation: { status: "unavailable", reason: "browser_tab_missing" },
    });
    expect(state.writes).toEqual([]);
  });
});
