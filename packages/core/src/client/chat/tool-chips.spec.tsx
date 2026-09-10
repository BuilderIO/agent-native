// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ToolChips } from "./tool-chips.js";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

describe("ToolChips", () => {
  it("renders code changes as unfenced rows with right-aligned stats", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <ToolChips
          diffs={[
            {
              file: "packages/toolkit/src/composer/MessageQueueDrawer.tsx",
              additions: 2,
              deletions: 0,
            },
          ]}
        />,
      );
    });

    const row = container.querySelector("[data-agent-tool-diff-row]");
    expect(row?.className).not.toContain("border");
    expect(row?.className).not.toContain("rounded");
    expect(row?.className).toContain("gap-2");
    expect(row?.className).toContain("agent-kit-activity-row");
    expect(row?.querySelector(".agent-kit-tone-positive")).not.toBeNull();
    expect(row?.textContent).toContain(
      "packages/toolkit/src/composer/MessageQueueDrawer.tsx",
    );
    expect(row?.textContent).toContain("+2");
    expect(row?.textContent).toContain("−0");
    expect(row?.querySelector("svg")).not.toBeNull();
    expect(
      row?.querySelector('[data-agent-activity-object="file"]')?.className,
    ).toContain("flex-1");
    expect(
      row?.querySelector('[data-agent-activity-object="file"]')?.className,
    ).not.toContain("text-[11px]");
    expect(row?.lastElementChild?.className).toContain("ms-auto");
  });
});
