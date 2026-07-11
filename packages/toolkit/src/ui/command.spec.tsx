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
): CommandDialogElement {
  return CommandDialog({
    children: "Commands",
    motion,
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
});
