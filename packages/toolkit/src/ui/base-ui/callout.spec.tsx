// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Callout,
  CalloutActions,
  CalloutIcon,
  type CalloutProps,
  CalloutText,
} from "./callout.js";

afterEach(cleanup);

describe("Callout part", () => {
  it("writes its variant, soft by default, inheriting its color", () => {
    render(
      <Callout data-testid="callout">
        <CalloutText>Saved.</CalloutText>
      </Callout>,
    );
    const callout = screen.getByTestId("callout");
    expect(callout.className).toBe("callout");
    expect(callout.dataset.variant).toBe("soft");
    expect(callout.dataset.color).toBeUndefined();
    expect(callout.dataset.highContrast).toBeUndefined();
  });

  it("writes color and high contrast as Radix names them", () => {
    render(
      <Callout
        data-testid="callout"
        variant="surface"
        color="warning"
        highContrast
      >
        <CalloutText>Usage couldn't load.</CalloutText>
      </Callout>,
    );
    const callout = screen.getByTestId("callout");
    expect(callout.dataset.variant).toBe("surface");
    expect(callout.dataset.color).toBe("warning");
    expect(callout.dataset.highContrast).toBe("");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "solid" } as unknown as CalloutProps;
    expect(() => render(<Callout {...props} />)).toThrow(
      /variant="solid" is not one of/,
    );
  });

  it("draws a hidden icon, the message as text, and its actions", () => {
    render(
      <Callout data-testid="callout" color="warning">
        <CalloutIcon>
          <svg />
        </CalloutIcon>
        <CalloutText>Usage couldn't load.</CalloutText>
        <CalloutActions>
          <button type="button">Retry</button>
        </CalloutActions>
      </Callout>,
    );
    const callout = screen.getByTestId("callout");
    expect(
      callout.querySelector(".callout-icon")?.getAttribute("aria-hidden"),
    ).toBe("true");
    const text = screen.getByText("Usage couldn't load.");
    expect(text.tagName).toBe("P");
    expect(text.className).toBe("callout-text");
    expect(
      screen.getByRole("button", { name: "Retry" }).parentElement?.className,
    ).toBe("callout-actions");
  });
});
