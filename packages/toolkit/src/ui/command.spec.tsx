import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  MenuSearchInput,
} from "./command.js";

describe("integrated search semantics", () => {
  it("uses a real searchbox for menus without dangling listbox relationships", () => {
    const html = renderToStaticMarkup(
      <MenuSearchInput aria-label="Search sources" />,
    );
    expect(html).toContain('role="searchbox"');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain("aria-controls");
    expect(html).toContain("border-b");
  });
  it("preserves the existing CommandInput combobox and associated CommandList", () => {
    const html = renderToStaticMarkup(
      <Command>
        <CommandInput />
        <CommandList />
      </Command>,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(controls).toBeDefined();
    expect(html).toContain(`id="${controls}"`);
  });
});

interface CommandDialogElement extends ReactElement {
  props: {
    children: ReactElement<{
      children: ReactNode;
      motion: "default" | "instant";
    }>;
  };
}

function renderCommandDialog(
  motion?: "default" | "instant",
  commandProps?: React.ComponentProps<typeof CommandDialog>["commandProps"],
): CommandDialogElement {
  return CommandDialog({
    children: "Commands",
    motion,
    commandProps,
  }) as CommandDialogElement;
}

describe("CommandDialog", () => {
  it("preserves standard dialog motion by default", () => {
    expect(renderCommandDialog().props.children.props.motion).toBe("default");
  });

  it("passes the instant motion option to its dialog content", () => {
    expect(renderCommandDialog("instant").props.children.props.motion).toBe(
      "instant",
    );
  });

  it("forwards command root behavior props", () => {
    const filter = () => 1;
    const dialog = renderCommandDialog(undefined, {
      filter,
      value: "selected-command",
    });
    const content = dialog.props.children;
    const command = (
      content.props.children as ReactElement<Record<string, unknown>>[]
    )[1];

    expect(command.props.filter).toBe(filter);
    expect(command.props.value).toBe("selected-command");
  });
});
