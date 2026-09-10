import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { CommandDialog } from "./command.js";

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
