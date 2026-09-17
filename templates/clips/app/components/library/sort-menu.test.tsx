import { describe, expect, it } from "vitest";

import { SortMenu } from "./sort-menu";

describe("SortMenu", () => {
  it("keeps the compact trigger focus ring inside its overflow slot", () => {
    type ElementWithProps = {
      props?: { children?: unknown; className?: unknown };
    };
    const findClassName = (node: unknown): string | undefined => {
      if (!node || typeof node !== "object") return undefined;
      if (Array.isArray(node)) {
        for (const child of node) {
          const className = findClassName(child);
          if (className) return className;
        }
        return undefined;
      }
      const props = (node as ElementWithProps).props;
      if (typeof props?.className === "string") return props.className;
      return findClassName(props?.children);
    };
    const className = findClassName(
      SortMenu({ value: "recent", onChange: () => {} }),
    );

    expect(className).toContain("focus-visible:ring-inset");
    expect(className).toContain("focus-visible:ring-offset-0");
  });
});
