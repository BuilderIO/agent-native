// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { WorkspaceAppSearch } from "./workspace-app-search";

describe("WorkspaceAppSearch", () => {
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

  it("clears from a button inside the field, not beside it", async () => {
    const onQueryChange = vi.fn();
    await act(async () =>
      root.render(
        <WorkspaceAppSearch query="" onQueryChange={onQueryChange} />,
      ),
    );
    const group = container.querySelector('[data-slot="input-group"]');
    expect(group?.querySelector("input")).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();

    await act(async () =>
      root.render(
        <WorkspaceAppSearch query="mail" onQueryChange={onQueryChange} />,
      ),
    );
    const clear = container.querySelector<HTMLButtonElement>(
      'button[aria-label="dispatch.pages.clearAppSearch"]',
    );
    expect(clear?.closest('[data-slot="input-group"]')).toBe(group);
    await act(async () => clear?.click());
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(group?.querySelector("input"));
  });
});
