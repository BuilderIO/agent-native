/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TimezoneSelect } from "./TimezoneSelect.js";

describe("TimezoneSelect", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("labels the trigger with the chosen zone only", () => {
    act(() => {
      root.render(
        <TimezoneSelect
          value="system"
          systemLabel="Follow this browser (UTC)"
          onChange={() => {}}
        />,
      );
    });

    const trigger = container.querySelector("[role=combobox]");
    expect(trigger?.textContent).toBe("Follow this browser (UTC)");
  });
});
