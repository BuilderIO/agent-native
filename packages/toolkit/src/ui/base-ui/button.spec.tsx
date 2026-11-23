// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, type ButtonProps, IconButton } from "./button.js";

afterEach(cleanup);

describe("Button part", () => {
  it("writes its variant, solid by default, inheriting its color", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.classList.contains("button")).toBe(true);
    expect(button.dataset.size).toBe("md");
    expect(button.dataset.variant).toBe("solid");
    expect(button.dataset.color).toBeUndefined();
    expect(button.dataset.highContrast).toBeUndefined();
  });

  it("writes color, high contrast and radius as Radix names them", () => {
    render(
      <Button
        size="sm"
        variant="soft"
        color="danger"
        highContrast
        radius="full"
      >
        Delete
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.dataset.size).toBe("sm");
    expect(button.dataset.variant).toBe("soft");
    expect(button.dataset.color).toBe("danger");
    expect(button.dataset.highContrast).toBe("");
    expect(button.dataset.radius).toBe("full");
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "link" } as unknown as ButtonProps;
    expect(() => render(<Button {...props}>Docs</Button>)).toThrow(
      /variant="link" is not one of/,
    );
  });

  it("keeps its name and width while loading, and doesn't fire", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent).toBe("Save");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([Button, IconButton])(
    "preserves a stateful child and its accessible name across loading",
    (Component) => {
      const subscribe = vi.fn(),
        unsubscribe = vi.fn();
      function Label() {
        useEffect(() => {
          subscribe();
          return unsubscribe;
        }, []);
        return <span id="save-label">Save changes</span>;
      }
      const { rerender, container, unmount } = render(
        <Component>
          <Label />
        </Component>,
      );
      const button = screen.getByRole("button", { name: "Save changes" });
      const label = button.firstElementChild;
      for (const loading of [true, false, true]) {
        rerender(
          <Component loading={loading}>
            <Label />
          </Component>,
        );
        expect(screen.getByRole("button", { name: "Save changes" })).toBe(
          button,
        );
        expect(button.firstElementChild).toBe(label);
        expect(container.querySelectorAll("#save-label")).toHaveLength(1);
        expect(subscribe).toHaveBeenCalledTimes(1);
        expect(unsubscribe).not.toHaveBeenCalled();
      }
      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    },
  );

  it("draws an icon button as its own part, named by its label", () => {
    render(
      <IconButton aria-label="Archive" variant="ghost" color="gray">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Archive" });
    expect(button.classList.contains("icon-button")).toBe(true);
    expect(button.classList.contains("button")).toBe(false);
    expect(button.dataset.variant).toBe("ghost");
  });

  it("does not fire while disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps button semantics on another element it renders as", () => {
    render(
      <Button render={<span />} nativeButton={false}>
        Docs
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Docs" });
    expect(button.tagName).toBe("SPAN");
    expect(button.classList.contains("button")).toBe(true);
  });

  it("stays disabled while loading and keeps a caller's aria-busy", () => {
    render(
      <>
        <Button loading disabled={false}>
          Save
        </Button>
        <Button aria-busy>Sync</Button>
      </>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    const sync = screen.getByRole("button", { name: "Sync" });
    expect({
      saveDisabled: save.hasAttribute("disabled"),
      saveBusy: save.getAttribute("aria-busy"),
      syncBusy: sync.getAttribute("aria-busy"),
    }).toEqual({ saveDisabled: true, saveBusy: "true", syncBusy: "true" });
  });
});
