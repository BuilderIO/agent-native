import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { Spinner } from "./spinner.js";

describe("Spinner", () => {
  it("honors explicit sizing and decorative semantics", () => {
    const spinner = Spinner({
      "aria-label": undefined,
      role: undefined,
      size: 10,
    }) as ReactElement<Record<string, unknown>>;

    expect(spinner.props.width).toBe(10);
    expect(spinner.props.height).toBe(10);
    expect(spinner.props.className).not.toContain("size-4");
    expect(spinner.props.role).toBeUndefined();
    expect(spinner.props["aria-label"]).toBeUndefined();
  });

  it("adds accessible defaults when role semantics are omitted", () => {
    const spinner = Spinner({}) as ReactElement<Record<string, unknown>>;

    expect(spinner.props.role).toBe("status");
    expect(spinner.props["aria-label"]).toBe("Loading");
    expect(spinner.props.className).toContain("size-4");
  });
});
