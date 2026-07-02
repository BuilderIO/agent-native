// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "../components/ui/dropdown-menu.js";
import { RunsTrayMenuItem } from "./RunsTray.js";

vi.mock("../api-path.js", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("../use-pausing-interval.js", () => ({
  usePausingInterval: () => undefined,
}));

describe("RunsTrayMenuItem", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([])),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("opens the runs submenu from a click", async () => {
    await act(async () => {
      root.render(
        <DropdownMenu open>
          <DropdownMenuContent forceMount>
            <RunsTrayMenuItem pollMs={0} />
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });

    expect(document.body.textContent).not.toContain("No recent runs");

    const trigger = document.querySelector(
      '[aria-label="Agent runs, No recent runs"]',
    );
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(document.body.textContent).toContain("No recent runs");
  });
});
