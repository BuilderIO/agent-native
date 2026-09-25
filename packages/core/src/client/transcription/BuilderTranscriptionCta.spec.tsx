// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  useBuilderConnectFlow: vi.fn(),
}));

vi.mock("../settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: mocks.useBuilderConnectFlow,
}));
vi.mock("../i18n.js", () => ({
  useT: () => (key: string) => key,
}));

import { BuilderTranscriptionCta } from "./BuilderTranscriptionCta.js";

describe("BuilderTranscriptionCta while connecting", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.useBuilderConnectFlow.mockReturnValue({
      cancel: mocks.cancel,
      configured: false,
      connecting: true,
      envManaged: false,
      error: null,
      hasFetchedStatus: true,
      statusResolved: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<BuilderTranscriptionCta />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps a localized cancel action available", () => {
    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("common.cancel");
    act(() => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
});
