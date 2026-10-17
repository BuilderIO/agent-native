// @vitest-environment happy-dom

import {
  act,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocationAutocomplete } from "./LocationAutocomplete";

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

function Harness({
  onFormKeyDown,
}: {
  onFormKeyDown?: KeyboardEventHandler<HTMLFormElement>;
}) {
  const [value, setValue] = useState("");
  return (
    <form onKeyDown={onFormKeyDown}>
      <LocationAutocomplete
        id="location"
        value={value}
        onChange={setValue}
        suggestions={["Home office", "Builder HQ", "Home studio"]}
        label="Location"
      />
    </form>
  );
}

describe("LocationAutocomplete", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("filters locations and selects the active suggestion with the keyboard", () => {
    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "home");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      Array.from(container.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Home office", "Home studio"]);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      "location-suggestions-option-0",
    );

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(input.value).toBe("Home office");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the suggestion list on Escape without bubbling to calendar shortcuts", () => {
    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.focus());
    const parentKeydown = vi.fn();
    window.addEventListener("keydown", parentKeydown);

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(escape));

    expect(escape.defaultPrevented).toBe(true);
    expect(parentKeydown).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    window.removeEventListener("keydown", parentKeydown);
  });

  it("lets an unhandled Enter reach the containing event form", () => {
    const onFormKeyDown = vi.fn();
    act(() => root.render(<Harness onFormKeyDown={onFormKeyDown} />));
    const input = container.querySelector<HTMLInputElement>("input")!;

    act(() => {
      input.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "nowhere");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(enter));

    expect(enter.defaultPrevented).toBe(false);
    expect(onFormKeyDown).toHaveBeenCalledTimes(1);
  });
});
