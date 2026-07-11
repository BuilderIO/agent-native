// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionQueryError } from "./action-query-error";

vi.mock("@agent-native/core/client", () => ({
  useT: () => (key: string) =>
    ({
      "dispatch.pages.dataLoadFailed": "Couldn't load data",
      "dispatch.pages.dataLoadFailedDescription":
        "Dispatch couldn't load this data.",
      "dispatch.pages.tryAgain": "Try again",
    })[key] ?? key,
}));

describe("ActionQueryError", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows a safe query error and retries on request", () => {
    const onRetry = vi.fn();
    act(() => {
      root.render(
        <ActionQueryError
          error={new Error("Database unavailable")}
          onRetry={onRetry}
        />,
      );
    });

    expect(container.textContent).toContain("Couldn't load data");
    expect(container.textContent).toContain(
      "Dispatch couldn't load this data.",
    );
    expect(container.textContent).not.toContain("Database unavailable");
    act(() => {
      container.querySelector("button")?.click();
    });
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
