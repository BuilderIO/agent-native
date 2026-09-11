// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_NATIVE_WORKSPACE_APP_ROUTE_MESSAGE_TYPE,
  postAgentNativeWorkspaceAppRoute,
} from "./workspace-app-navigation";

describe("workspace app route reporting", () => {
  const parentWindow = { postMessage: vi.fn() };

  beforeEach(() => {
    parentWindow.postMessage.mockClear();
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parentWindow,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: window,
    });
  });

  it("posts a normalized route to an embedding parent", () => {
    expect(postAgentNativeWorkspaceAppRoute("/foobar?mode=edit#canvas")).toBe(
      true,
    );
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      {
        type: AGENT_NATIVE_WORKSPACE_APP_ROUTE_MESSAGE_TYPE,
        path: "/foobar?mode=edit#canvas",
      },
      "*",
    );
  });

  it("rejects unsafe routes and does not report when top-level", () => {
    expect(postAgentNativeWorkspaceAppRoute("//evil.example")).toBe(false);
    expect(parentWindow.postMessage).not.toHaveBeenCalled();

    Object.defineProperty(window, "parent", {
      configurable: true,
      value: window,
    });
    expect(postAgentNativeWorkspaceAppRoute("/top-level")).toBe(false);
  });
});
