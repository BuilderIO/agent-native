// @vitest-environment happy-dom

import type { ContentPart } from "@agent-native/core/client/agent-chat";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

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
    expect(row?.getAttribute("aria-expanded")).toBe("false");
    expect(path?.getAttribute("title")).toBe(
      "packages/toolkit/src/composer/MessageQueueDrawer.spec.tsx",
    );
    // The file name is its own box, so a long directory truncates first.
    expect(path?.querySelector(".agentkit-file-path-name")?.textContent).toBe(
      "MessageQueueDrawer.spec.tsx",
    );
    expect(stats?.textContent).toBe("+2−0");
    expect(stats?.querySelector('[data-sign="added"]')?.textContent).toBe("+2");

    act(() => (row as HTMLButtonElement).click());
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".agentkit-code-line"),
        (line) => [line.textContent, line.dataset.variant ?? "context"],
      ),
    ).toEqual([
      ["first", "context"],
      ["second", "context"],
      ["Added third", "added"],
      ["Added fourth", "added"],
    ]);
  });

  it("counts a same-length rewrite by its diff, and keeps each file's latest change", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const edit = (newText: string) =>
      ({
        type: "tool-call",
        toolName: "edit-file",
        structuredMeta: {
          toolKind: "edit",
          filePath: "src/a.ts",
          oldText: "one\ntwo",
          newText,
        },
      }) as ContentPart;
    const parts = [
      edit("one\nTWO"),
      {
        type: "tool-call",
        toolName: "write-file",
        structuredMeta: {
          toolKind: "write",
          filePath: "src/b.ts",
          content: "x\ny\nz",
        },
      },
      edit("ONE\nTWO"),
    ] as ContentPart[];
    act(() => {
      root.render(<FilesChangedSummary parts={parts} />);
    });
    expect(
      Array.from(
        container.querySelectorAll("[data-agent-file-change-stats]"),
        (stats) => stats.textContent,
      ),
    ).toEqual(["+2−2", "+3"]);
  });
});
