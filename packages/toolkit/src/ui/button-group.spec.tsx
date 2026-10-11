// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { ActionButtonProps } from "../design-system/types.js";
import { ToolkitProvider } from "../provider.js";
import { ButtonGroup, ButtonGroupSeparator } from "./button-group.js";
import { Button } from "./button.js";

describe("ButtonGroup", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) root.unmount();
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
  });

  it("styles mixed controls and host ActionButton wrappers without toolkit slots", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    const HostActionButton = ({
      children,
      className,
      disabled,
      elementRef,
      onPress,
      type,
    }: ActionButtonProps) => (
      <span className={className}>
        <button
          ref={elementRef}
          disabled={disabled}
          onClick={() => onPress?.()}
          type={type}
        >
          {children}
        </button>
      </span>
    );

    await act(async () => {
      root.render(
        <ToolkitProvider
          designSystem={{ components: { ActionButton: HostActionButton } }}
        >
          <ButtonGroup>
            <a href="/share">Share</a>
            <Button>Copy</Button>
            <ButtonGroupSeparator />
            <button type="button">Open</button>
            <select aria-hidden="true" tabIndex={-1} />
          </ButtonGroup>
          <ButtonGroup orientation="vertical">
            <Button>Start</Button>
            <Button>Stop</Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button>Before nested group</Button>
            <ButtonGroup>
              <Button>Nested action</Button>
              <Button>Nested menu</Button>
            </ButtonGroup>
            <Button>After nested group</Button>
          </ButtonGroup>
        </ToolkitProvider>,
      );
    });

    const [horizontal, vertical, nested] = Array.from(
      container.querySelectorAll<HTMLElement>('[data-slot="button-group"]'),
    );
    expect(horizontal?.firstElementChild?.tagName).toBe("A");
    expect(horizontal?.children[1]?.tagName).toBe("SPAN");
    expect(vertical?.firstElementChild?.tagName).toBe("SPAN");
    expect(
      horizontal?.className.includes(
        "*:not([data-button-group-ignore]):not(select[aria-hidden=true]):not(:first-child):not([data-slot=button-group]):not([data-slot=button-group]+*)",
      ),
    ).toBe(true);
    expect(
      horizontal?.className.includes(
        ":not([data-slot=button-group-separator]+*)",
      ),
    ).toBe(true);
    expect(
      vertical?.className.includes(
        "*:not([data-button-group-ignore]):not(select[aria-hidden=true]):not(:first-child):not([data-slot=button-group]):not([data-slot=button-group]+*)",
      ),
    ).toBe(true);
    expect(
      vertical?.className.includes(
        ":not([data-slot=button-group-separator]+*)",
      ),
    ).toBe(true);
    expect(nested?.className).toContain("border-s-current/20");
    expect(
      horizontal?.querySelector('[data-slot="button-group-separator"]'),
    ).not.toBeNull();
    expect(horizontal?.lastElementChild?.tagName).toBe("SELECT");
    expect(
      Array.from(container.querySelectorAll("button")).every(
        (button) => !button.hasAttribute("data-slot"),
      ),
    ).toBe(true);
  });
});
