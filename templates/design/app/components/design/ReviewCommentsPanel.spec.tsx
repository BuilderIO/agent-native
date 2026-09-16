import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  latestPanelProps: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/client/review", () => ({
  ReviewThreadPanel: (props: Record<string, unknown>) => {
    mocks.latestPanelProps = props;
    return <div data-review-thread-panel />;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

import { ReviewCommentsPanel } from "./ReviewCommentsPanel";

describe("ReviewCommentsPanel capabilities", () => {
  beforeEach(() => {
    mocks.latestPanelProps = null;
  });

  it("keeps the sidebar design-wide and leaves comment creation to canvas pins", () => {
    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment
        canResolve={false}
        canDispatchToAgent={false}
      />,
    );

    expect(mocks.latestPanelProps).toMatchObject({
      showComposer: false,
      showComposerTargetPicker: false,
      canResolve: false,
    });
    expect(mocks.latestPanelProps).not.toHaveProperty("targetId");
    expect(mocks.latestPanelProps?.renderThreadActions).toBeUndefined();
  });

  it("shows agent routing only when the caller grants dispatch capability", () => {
    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        canComment
        canResolve
        canDispatchToAgent
        onSendThreadToAgent={vi.fn()}
      />,
    );

    expect(mocks.latestPanelProps).toMatchObject({
      canResolve: true,
      showComposer: false,
      showComposerTargetPicker: false,
    });
    expect(mocks.latestPanelProps?.renderThreadActions).toBeTypeOf("function");
  });
});
