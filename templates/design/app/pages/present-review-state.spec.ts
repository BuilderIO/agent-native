import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reviewEmbedSearch: "",
  reviewQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: {
      id: "design-1",
      title: "Example",
      files: [
        {
          id: "screen-1",
          filename: "index.html",
          fileType: "html",
          content: "<main>Preview</main>",
        },
      ],
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useSession: () => ({ session: null }),
}));

vi.mock("@agent-native/core/client/host", () => ({
  injectSessionReplayIframeBootstrap: (html: string) => html,
  SESSION_REPLAY_IFRAME_ATTRIBUTE: "data-session-replay",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/review", () => ({
  buildReviewThreads: () => [],
  ReviewStatusBadge: () => null,
  useReviewComments: (...args: unknown[]) => mocks.reviewQuery(...args),
}));

vi.mock("@agent-native/core/client/ui", () => ({
  buildSignInReturnHref: () => "/sign-in",
}));

vi.mock("@agent-native/core/shared", () => ({
  normalizeDocumentTitle: (title: string) => title,
}));

vi.mock("@shared/review-summary", () => ({
  readDesignReviewSummary: () => null,
}));

vi.mock("@tabler/icons-react", () => ({
  IconMessageCircle: () => null,
}));

vi.mock("react-router", () => ({
  Link: () => null,
  useLocation: () => ({ hash: "" }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "design-1" }),
  useSearchParams: () => [new URLSearchParams(mocks.reviewEmbedSearch)],
}));

vi.mock("@/components/design/design-canvas/hit-test", () => ({
  appendHitTestResponder: (html: string) => html,
}));

vi.mock("@/components/design/review-link", () => ({
  reviewThreadIdFromHash: () => null,
}));

vi.mock("@/components/design/ReviewCommentsPanel", () => ({
  ReviewCommentsPanel: () => "review-comments-panel",
}));

vi.mock("@/components/QueryErrorState", () => ({
  QueryErrorState: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) => children ?? null,
}));

vi.mock("@/components/ui/sheet", () => {
  const passthrough = ({ children }: { children?: ReactNode }) =>
    children ?? null;
  return {
    Sheet: passthrough,
    SheetContent: passthrough,
    SheetDescription: passthrough,
    SheetHeader: passthrough,
    SheetTitle: passthrough,
  };
});

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => null,
}));

vi.mock("@/components/visual-editor/ReviewCanvasPins", () => ({
  ReviewCanvasPins: () => "review-canvas-pins",
}));

vi.mock("../components/design/design-canvas/local-runtime", () => ({
  withLocalRuntimes: (html: string) => html,
}));

import Present from "./Present";
import {
  resolvePresentEscapeAction,
  shouldBlockPresentPageNavigation,
} from "./present-review-state";

describe("present review keyboard state", () => {
  it("closes the comments sheet before leaving presentation mode", () => {
    expect(
      resolvePresentEscapeAction({ commentsOpen: true, commentMode: false }),
    ).toBe("close-comments");
  });

  it("defers Escape to the staged pin composer while comment mode is active", () => {
    expect(
      resolvePresentEscapeAction({ commentsOpen: false, commentMode: true }),
    ).toBe("defer-to-comment-mode");
  });

  it("leaves presentation mode only when no review UI is active", () => {
    expect(
      resolvePresentEscapeAction({ commentsOpen: false, commentMode: false }),
    ).toBe("exit-presentation");
  });

  it("keeps Escape inside the review embed when no review UI is active", () => {
    expect(
      resolvePresentEscapeAction(
        { commentsOpen: false, commentMode: false },
        true,
      ),
    ).toBe("stay-in-review-embed");
  });

  it("blocks slide navigation while either review surface is active", () => {
    expect(
      shouldBlockPresentPageNavigation({
        commentsOpen: true,
        commentMode: false,
      }),
    ).toBe(true);
    expect(
      shouldBlockPresentPageNavigation({
        commentsOpen: false,
        commentMode: true,
      }),
    ).toBe(true);
    expect(
      shouldBlockPresentPageNavigation({
        commentsOpen: false,
        commentMode: false,
      }),
    ).toBe(false);
  });
});

describe("Present review embed mode", () => {
  beforeEach(() => {
    mocks.reviewEmbedSearch = "";
    mocks.reviewQuery.mockReset().mockReturnValue({ data: { comments: [] } });
  });

  it("disables review fetches and omits review controls in embed mode", () => {
    mocks.reviewEmbedSearch = "reviewEmbed=1";

    const markup = renderToStaticMarkup(createElement(Present));

    expect(mocks.reviewQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "design",
        resourceId: "design-1",
      }),
      { enabled: false },
    );
    expect(markup).toContain("data-design-preview-iframe");
    expect(markup).not.toContain("review.presentComments");
    expect(markup).not.toContain("pages.presentExitHint");
    expect(markup).not.toContain("review-comments-panel");
    expect(markup).not.toContain("review-canvas-pins");
  });

  it("keeps the review query and controls on the normal presentation route", () => {
    const markup = renderToStaticMarkup(createElement(Present));

    expect(mocks.reviewQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "design",
        resourceId: "design-1",
      }),
      { enabled: true },
    );
    expect(markup).toContain("review.presentComments");
    expect(markup).toContain("review-comments-panel");
    expect(markup).toContain("review-canvas-pins");
  });
});
