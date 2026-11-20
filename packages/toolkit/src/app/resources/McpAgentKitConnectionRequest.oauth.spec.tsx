// @vitest-environment happy-dom

import {
  clearMcpConnectionResume,
  getPendingMcpConnectionResume,
} from "@agent-native/core/client/resources/mcp-connection-resume";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateToMcpOAuthStart: vi.fn(),
  capturedSuggestionProps: null as null | {
    onOAuthStart?: (url: string) => void | Promise<void>;
  },
}));

vi.mock(
  "@agent-native/core/client/resources/mcp-integration-catalog",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@agent-native/core/client/resources/mcp-integration-catalog")
      >();
    return {
      ...actual,
      navigateToMcpOAuthStart: mocks.navigateToMcpOAuthStart,
    };
  },
);

vi.mock("./McpConnectionSuggestion.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./McpConnectionSuggestion.js")>();
  return {
    ...actual,
    McpConnectionSuggestion: (props: {
      onOAuthStart?: (url: string) => void | Promise<void>;
    }) => {
      mocks.capturedSuggestionProps = props;
      return null;
    },
  };
});

import { McpAgentKitConnectionRequestCard } from "./McpAgentKitConnectionRequest.js";

describe("McpAgentKitConnectionRequestCard OAuth start failure", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clearMcpConnectionResume();
    mocks.navigateToMcpOAuthStart.mockReset();
    mocks.capturedSuggestionProps = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearMcpConnectionResume();
    vi.unstubAllGlobals();
  });

  it("clears the saved resume record and throws when navigateToMcpOAuthStart fails", () => {
    mocks.navigateToMcpOAuthStart.mockReturnValue(false);

    act(() => {
      root.render(
        <McpAgentKitConnectionRequestCard
          provider="linear"
          detail="Connect Linear to check issues."
          target={{
            threadId: "thread-1",
            runId: "run-1",
            requestId: "req-1",
          }}
          onConnected={() => undefined}
          onDeclined={() => undefined}
        />,
      );
    });

    expect(mocks.capturedSuggestionProps?.onOAuthStart).toBeTypeOf("function");
    expect(() =>
      mocks.capturedSuggestionProps?.onOAuthStart?.(
        "/_agent-native/mcp/servers/oauth/start?name=Linear",
      ),
    ).toThrow();
    expect(getPendingMcpConnectionResume()).toBeNull();
  });
});
