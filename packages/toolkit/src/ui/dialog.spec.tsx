import type { ForwardedRef, ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { DialogContent, DialogOverlay } from "./dialog.js";

type OverlayProps = React.ComponentProps<typeof DialogOverlay>;
type ContentProps = React.ComponentProps<typeof DialogContent>;

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

function renderDialogContentClassName(props: ContentProps): string {
  const content = DialogContent as unknown as {
    render: (
      props: ContentProps,
      ref: ForwardedRef<HTMLDivElement>,
    ) => ReactElement<{ children: ReactElement<{ className: string }>[] }>;
  };
  const portal = content.render(props, null);
  const [, pinned] = portal.props.children;

  return pinned!.props.className;
}

function classNames(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

describe("DialogContent", () => {
  it("pins itself to the viewport and scrolls content past its max height", () => {
    const className = renderDialogContentClassName({});
    const tokens = classNames(className);

    expect(tokens).toContain("fixed");
    expect(tokens).toContain("left-1/2");
    expect(tokens).toContain("top-1/2");
    expect(tokens).toContain("max-h-[min(760px,calc(100vh-32px))]");
    // overflow-hidden clipped footers and advanced rows with no way to reach
    // them once the dialog hit its max height on a short viewport.
    expect(tokens).toContain("overflow-y-auto");
    expect(tokens).not.toContain("overflow-hidden");
  });

  it("keeps its own positioning when a caller only tunes width", () => {
    const tokens = classNames(
      renderDialogContentClassName({ className: "sm:max-w-[680px]" }),
    );

    expect(tokens).toContain("fixed");
    expect(tokens).toContain("sm:max-w-[680px]");
  });

  it("loses its pinning when a caller passes a position utility", () => {
    // Records why guard:modal-layer-integrity rejects that className: the
    // merge is silent, and the dialog then lands below the page fold.
    const tokens = classNames(
      renderDialogContentClassName({ className: "relative" }),
    );

    expect(tokens).not.toContain("fixed");
    expect(tokens).toContain("relative");
  });
});

describe("DialogOverlay", () => {
  it("transitions only the backdrop blur for instant dialogs", () => {
    const overlay = renderDialogOverlay({ motion: "instant" });

    expect(overlay.props.className).toContain(
      "transition-[backdrop-filter] duration-[1000ms] ease-[var(--ease-out-strong)]",
    );
    expect(overlay.props.className).toContain(
      "starting:[backdrop-filter:blur(0px)]",
    );
    expect(overlay.props.className).toContain("backdrop-blur-[1px]");
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
