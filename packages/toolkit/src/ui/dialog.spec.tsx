import type { ForwardedRef, ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { DialogOverlay } from "./dialog.js";

type OverlayProps = React.ComponentProps<typeof DialogOverlay>;

function renderDialogOverlay(props: OverlayProps): ReactElement<{
  className: string;
}> {
  const overlay = DialogOverlay as unknown as {
    render: (
      props: OverlayProps,
      ref: ForwardedRef<HTMLDivElement>,
    ) => ReactElement<{ className: string }>;
  };

  return overlay.render(props, null);
}

describe("DialogOverlay", () => {
  it("transitions only the backdrop blur for instant dialogs", () => {
    const overlay = renderDialogOverlay({ motion: "instant" });

    expect(overlay.props.className).toContain(
      "transition-[backdrop-filter] duration-200 ease-[var(--ease-out-strong)]",
    );
    expect(overlay.props.className).toContain(
      "starting:[backdrop-filter:blur(0px)]",
    );
    expect(overlay.props.className).toContain("backdrop-blur-[4px]");
    expect(overlay.props.className).not.toContain("animate-in");
  });

  it("keeps standard dialog overlay motion unchanged", () => {
    const overlay = renderDialogOverlay({});

    expect(overlay.props.className).toContain("animate-in");
    expect(overlay.props.className).not.toContain(
      "transition-[backdrop-filter]",
    );
  });
});
