// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScrollArea, type ScrollAreaProps } from "./scroll-area.js";

afterEach(cleanup);

describe("ScrollArea part", () => {
  it("writes its size and scrollbars, size 1 on both axes by default", () => {
    const { container } = render(
      <ScrollArea>
        <p>Rows</p>
      </ScrollArea>,
    );
    const root = container.querySelector<HTMLElement>(".scroll-area");
    expect(root?.dataset.size).toBe("1");
    expect(root?.dataset.scrollbars).toBe("both");
    expect(root?.dataset.radius).toBeUndefined();
    expect(root?.querySelector(".scroll-area-viewport")?.textContent).toBe(
      "Rows",
    );
  });

  it("writes size, radius and the scrollbars asked for", () => {
    const { container } = render(
      <ScrollArea size="3" radius="none" scrollbars="vertical">
        <p>Rows</p>
      </ScrollArea>,
    );
    const root = container.querySelector<HTMLElement>(".scroll-area");
    expect(root?.dataset.size).toBe("3");
    expect(root?.dataset.radius).toBe("none");
    expect(root?.dataset.scrollbars).toBe("vertical");
    expect(root?.querySelector(".scroll-area-corner")).toBeNull();
  });

  it("refuses scrollbars it doesn't have instead of drawing the default", () => {
    const props = { scrollbars: "none" } as unknown as ScrollAreaProps;
    expect(() => render(<ScrollArea {...props} />)).toThrow(
      /scrollbars="none" is not one of/,
    );
  });
});
