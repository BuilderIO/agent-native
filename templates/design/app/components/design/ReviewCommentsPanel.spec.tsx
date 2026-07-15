import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  latestPanelProps: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/client", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  ReviewThreadPanel: (props: Record<string, unknown>) => {
    mocks.latestPanelProps = props;
    return <div data-review-thread-panel />;
  },
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: ReactNode }) => children,
  TabsList: ({ children }: { children?: ReactNode }) => children,
  TabsTrigger: ({ children }: { children?: ReactNode }) => children,
}));

import {
  ReviewCommentsPanel,
  resolveReviewComposerTargetId,
} from "./ReviewCommentsPanel";

describe("resolveReviewComposerTargetId", () => {
  it("targets the active screen in This screen scope", () => {
    expect(
      resolveReviewComposerTargetId({
        scope: "screen",
        activeFileId: "screen-1",
      }),
    ).toBe("screen-1");
  });

  it("keeps unanchored All screens comments design-wide", () => {
    expect(
      resolveReviewComposerTargetId({
        scope: "all",
        activeFileId: "screen-1",
      }),
    ).toBeUndefined();
  });

  it("targets the active screen for an anchored layer in All screens scope", () => {
    expect(
      resolveReviewComposerTargetId({
        scope: "all",
        activeFileId: "screen-1",
        commentAnchor: {
          nodeId: "hero-title",
          point: { xPct: 25, yPct: 30 },
        },
      }),
    ).toBe("screen-1");
  });
});

describe("ReviewCommentsPanel capabilities", () => {
  beforeEach(() => {
    mocks.latestPanelProps = null;
  });

  it("targets a selected layer without exposing agent controls to viewers", () => {
    const dispatch = vi.fn();
    const anchor = {
      nodeId: "hero-title",
      point: { xPct: 25, yPct: 30 },
    };
    const metadata = { layerName: "Hero title", tagName: "h1" };

    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        activeFileId="screen-1"
        commentAnchor={anchor}
        commentMetadata={metadata}
        commentContextLabel="Commenting on Hero title"
        canComment
        canResolve={false}
        canDispatchToAgent={false}
        onDispatchCommentToAgent={dispatch}
      />,
    );

    expect(mocks.latestPanelProps).toMatchObject({
      targetId: "screen-1",
      composerTargetId: "screen-1",
      composerAnchor: anchor,
      composerMetadata: metadata,
      composerContextLabel: "Commenting on Hero title",
      canResolve: false,
      showComposerTargetPicker: false,
    });
    expect(mocks.latestPanelProps?.renderThreadActions).toBeUndefined();

    const onCommentCreated = mocks.latestPanelProps
      ?.onCommentCreated as (comment: { resolutionTarget: "agent" }) => void;
    onCommentCreated({ resolutionTarget: "agent" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("shows agent routing only when the caller grants dispatch capability", () => {
    renderToStaticMarkup(
      <ReviewCommentsPanel
        designId="design-1"
        activeFileId="screen-1"
        canComment
        canResolve
        canDispatchToAgent
        onSendThreadToAgent={vi.fn()}
      />,
    );

    expect(mocks.latestPanelProps).toMatchObject({
      canResolve: true,
      showComposerTargetPicker: true,
    });
    expect(mocks.latestPanelProps?.renderThreadActions).toBeTypeOf("function");
  });
});
