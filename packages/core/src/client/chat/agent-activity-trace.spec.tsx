// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentActivityTrace,
  summarizeAgentActivityItems,
} from "./agent-activity-trace.js";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

describe("AgentActivityTrace", () => {
  it("summarizes the actual activity labels instead of elapsed time", () => {
    expect(
      summarizeAgentActivityItems([
        { id: "read", label: "read files" },
        { id: "run", label: "exec command" },
        { id: "search", label: "search code" },
      ]),
    ).toBe("Read files, exec command +1");
  });

  it("keeps multiple activity details expanded at the same time", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <AgentActivityTrace
          defaultOpen
          items={[
            {
              id: "reasoning",
              label: "Reasoning",
              summary: <p>Compared the two layouts</p>,
            },
            {
              id: "command",
              label: "exec command",
              detail: "pnpm test --filter core",
              summary: <p>All focused tests passed</p>,
            },
          ]}
        />,
      );
    });

    const itemButtons = Array.from(container.querySelectorAll("button")).slice(
      1,
    );
    act(() => itemButtons[0]?.click());
    act(() => itemButtons[1]?.click());

    expect(container.textContent).toContain("Compared the two layouts");
    expect(container.textContent).toContain("All focused tests passed");
    expect(container.textContent).toContain("pnpm test --filter core");
    for (const details of container.querySelectorAll(
      "[data-agent-activity-item-details]",
    )) {
      expect(details.className).toContain("agent-kit-density");
      expect(details.className).not.toContain("border-s");
      expect(details.className).not.toContain("ps-");
      expect(details.className).not.toContain("ms-");
    }
  });

  it("keeps row values right aligned and opens referenced smart objects", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    let opened = 0;

    act(() => {
      root.render(
        <AgentActivityTrace
          defaultOpen
          items={[
            {
              id: "file",
              label: "Read file",
              variant: "read",
              object: {
                kind: "file",
                label: "src/analytics.ts:42",
                mono: true,
                onOpen: () => opened++,
              },
            },
            {
              id: "checks",
              label: "Run checks",
              variant: "command",
              detail: "12 passed",
            },
          ]}
        />,
      );
    });

    const object = container.querySelector(
      '[data-agent-activity-object="file"]',
    );
    expect(object?.className).toContain("text-right");
    expect(object?.className).toContain("font-mono");
    expect(object?.className).not.toContain("text-[11px]");
    expect(container.textContent).toContain("12 passed");
    act(() => (object as HTMLButtonElement).click());
    expect(opened).toBe(1);
  });
});
