// @vitest-environment happy-dom
import type { Node } from "@tiptap/pm/model";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/editor", () => ({
  DragHandle: { configure: (options: unknown) => ({ options }) },
}));

import { DragHandle } from "./DragHandle";

const reference = { type: { name: "contentReference" } } as Node;
afterEach(() => {
  document.documentElement.lang = "";
});

describe("Content block removal labels", () => {
  it("names reference removal explicitly and keeps other block defaults", () => {
    document.documentElement.lang = "en-US";
    expect(DragHandle.options.getDeleteLabel?.(reference)).toBe(
      "Remove reference",
    );
    expect(
      DragHandle.options.getDeleteLabel?.({
        type: { name: "paragraph" },
      } as Node),
    ).toBeUndefined();
  });
  it("resolves the current locale when the menu opens", () => {
    document.documentElement.lang = "ja-JP";
    expect(DragHandle.options.getDeleteLabel?.(reference)).toBe("参照を削除");
    document.documentElement.lang = "de-DE";
    expect(DragHandle.options.getDeleteLabel?.(reference)).toBe(
      "Referenz entfernen",
    );
  });
});
