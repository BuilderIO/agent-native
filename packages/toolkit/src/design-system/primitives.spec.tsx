// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef, type ComponentPropsWithRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolkitProvider } from "../provider.js";
import { Button } from "../ui/base-ui/button.js";
import { defineDesignSystem } from "./definition.js";

afterEach(cleanup);

function AlternateButton(props: ComponentPropsWithRef<typeof Button>) {
  const { ref, children } = props;
  return (
    <button ref={ref} type="button" data-drawn="alternate">
      {children}
    </button>
  );
}

const alternate = defineDesignSystem({
  name: "alternate",
  primitives: { Button: AlternateButton },
});

describe("primitives", () => {
  it("draws toolkit's primitive when the design system replaces none", () => {
    render(
      <ToolkitProvider designSystem={defineDesignSystem({ name: "plain" })}>
        <Button>Save</Button>
      </ToolkitProvider>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.dataset.drawn).toBeUndefined();
    expect(save.classList.contains("button")).toBe(true);
  });

  it("replaces a primitive by name with the same props and ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <ToolkitProvider designSystem={alternate}>
        <Button ref={ref}>Send</Button>
      </ToolkitProvider>,
    );
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.dataset.drawn).toBe("alternate");
    expect(ref.current).toBe(send);
  });

  it("keeps replacements through a nested design system that sets none", () => {
    render(
      <ToolkitProvider designSystem={alternate}>
        <ToolkitProvider designSystem={defineDesignSystem({ name: "nested" })}>
          <Button>Nested</Button>
        </ToolkitProvider>
        <ToolkitProvider
          designSystem={defineDesignSystem({ name: "own", primitives: {} })}
        >
          <Button>Own</Button>
        </ToolkitProvider>
      </ToolkitProvider>,
    );
    expect(screen.getByRole("button", { name: "Nested" }).dataset.drawn).toBe(
      "alternate",
    );
    expect(
      screen.getByRole("button", { name: "Own" }).dataset.drawn,
    ).toBeUndefined();
  });
});
