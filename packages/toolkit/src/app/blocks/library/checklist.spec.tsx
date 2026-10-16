import type { ChecklistData } from "@agent-native/core/blocks/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChecklistBlock, ChecklistEditor } from "./checklist.js";

describe("checklist blocks", () => {
  it("renders a legacy checklist without items", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ChecklistBlock, {
          data: {} as unknown as ChecklistData,
          blockId: "checklist-1",
          ctx: {},
        }),
      ),
    ).not.toThrow();
  });

  it("opens an empty editor for a legacy checklist without items", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(ChecklistEditor, {
          data: {} as unknown as ChecklistData,
          onChange: vi.fn(),
          editable: true,
          blockId: "checklist-1",
          ctx: {},
        }),
      ),
    ).not.toThrow();
  });
});
