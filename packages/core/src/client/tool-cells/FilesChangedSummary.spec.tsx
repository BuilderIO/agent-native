// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { ContentPart } from "../sse-event-processor.js";
import { FilesChangedSummary } from "./FilesChangedSummary.js";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

describe("FilesChangedSummary", () => {
  it("keeps long paths flexible and line counts pinned to the right", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const parts = [
      {
        type: "tool-call",
        toolName: "edit-file",
        structuredMeta: {
          toolKind: "edit",
          filePath: "packages/toolkit/src/composer/MessageQueueDrawer.spec.tsx",
          oldText: "first\nsecond",
          newText: "first\nsecond\nthird\nfourth",
        },
      },
    ] as ContentPart[];

    act(() => {
      root.render(<FilesChangedSummary parts={parts} />);
    });

    const summary = container.querySelector("[data-agent-files-changed]");
    const row = container.querySelector("[data-agent-file-change-row]");
    const path = container.querySelector("[data-agent-file-change-path]");
    const stats = container.querySelector("[data-agent-file-change-stats]");
    expect(summary?.className).not.toContain("border");
    expect(summary?.className).not.toContain("rounded");
    expect(container.textContent).not.toContain("file changed");
    expect(row).not.toBeNull();
    expect(path?.className).toContain("flex-1");
    expect(path?.textContent).toContain("MessageQueueDrawer.spec.tsx");
    expect(stats?.className).toContain("ms-auto");
    expect(stats?.textContent).toBe("+2−0");
    expect(stats?.querySelector(".agent-kit-tone-positive")).not.toBeNull();
  });
});
