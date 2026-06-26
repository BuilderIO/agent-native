// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectBuilderCard } from "./ConnectBuilderCard.js";

const mocks = vi.hoisted(() => ({
  useBuilderConnectFlow: vi.fn(),
  start: vi.fn(),
}));

vi.mock("./settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));

describe("ConnectBuilderCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.useBuilderConnectFlow.mockReturnValue({
      hasFetchedStatus: true,
      configured: true,
      builderEnabled: false,
      orgName: "Builder space",
      envManaged: false,
      connecting: false,
      error: null,
      start: mocks.start,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a code-change fallback when Builder Cloud Agents are unavailable", () => {
    act(() => {
      root.render(
        <ConnectBuilderCard
          configured
          builderEnabled={false}
          connectUrl="https://builder.io/cli-auth"
          prompt="Update the dashboard layout"
        />,
      );
    });

    expect(container.textContent).toContain("This requires a code change");
    expect(container.textContent).toContain(
      "Edit locally or use Builder.io to edit this code in the cloud and continue customizing the app any way you like.",
    );
    expect(container.textContent).not.toContain(
      "Builder Cloud Agents coming soon",
    );
    expect(container.textContent).not.toContain("Send to Builder");
  });
});
