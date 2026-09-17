import { describe, expect, it } from "vitest";

import { buttonVariants } from "@/components/ui/button";

import { SortMenu } from "./sort-menu";

describe("SortMenu", () => {
  it("keeps the compact trigger focus ring inside its overflow slot", () => {
    type ElementWithProps = {
      props?: { children?: unknown; variant?: unknown };
    };
    const findVariant = (node: unknown): unknown => {
      if (!node || typeof node !== "object") return undefined;
      if (Array.isArray(node)) {
        for (const child of node) {
          const variant = findVariant(child);
          if (variant) return variant;
        }
        return undefined;
      }
      const props = (node as ElementWithProps).props;
      if (props?.variant) return props.variant;
      return findVariant(props?.children);
    };
    const variant = findVariant(
      SortMenu({ value: "recent", onChange: () => {} }),
    );

    expect(variant).toBe("ghost-inset");
    expect(buttonVariants({ variant: "ghost-inset" })).toContain(
      "focus-visible:ring-inset",
    );
    expect(buttonVariants({ variant: "ghost-inset" })).toContain(
      "focus-visible:ring-offset-0",
    );
  });
});
