// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Code, type CodeProps } from "./code.js";

afterEach(cleanup);

describe("Code part", () => {
  it("renders a code element, soft by default, following the text's size", () => {
    render(<Code>pnpm install</Code>);
    const code = screen.getByText("pnpm install");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toBe("code");
    expect(code.dataset.variant).toBe("soft");
    expect(code.dataset.size).toBeUndefined();
    expect(code.dataset.color).toBeUndefined();
  });

  it("writes its variant, weight, color and high contrast", () => {
    render(
      <Code variant="outline" weight="bold" color="info" highContrast>
        --force
      </Code>,
    );
    const code = screen.getByText("--force");
    expect({ ...code.dataset }).toEqual({
      variant: "outline",
      weight: "bold",
      color: "info",
      highContrast: "",
    });
  });

  it("writes truncate and wrap", () => {
    render(
      <Code truncate wrap="nowrap">
        pnpm --filter toolkit test
      </Code>,
    );
    const code = screen.getByText("pnpm --filter toolkit test");
    expect(code.dataset.truncate).toBe("");
    expect(code.dataset.wrap).toBe("nowrap");
  });

  it("refuses a variant it doesn't have", () => {
    const props = { variant: "surface" } as unknown as CodeProps;
    expect(() => render(<Code {...props}>x</Code>)).toThrow(
      /variant="surface" is not one of/,
    );
  });
});
