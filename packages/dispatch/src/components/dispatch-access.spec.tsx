// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequireDispatchAccess } from "./dispatch-access.js";

describe("RequireDispatchAccess", () => {
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

  it("renders the Dispatch shell for every authenticated user", () => {
    act(() => {
      root.render(
        <RequireDispatchAccess>
          <div data-dispatch-shell>Dispatch shell</div>
        </RequireDispatchAccess>,
      );
    });

    expect(container.querySelector("[data-dispatch-shell]")).not.toBeNull();
  });
});
