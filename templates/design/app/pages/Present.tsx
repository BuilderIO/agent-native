import { useActionQuery, useSession } from "@agent-native/core/client/hooks";
import {
  injectSessionReplayIframeBootstrap,
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
} from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import {
  buildReviewThreads,
  ReviewStatusBadge,
  useReviewComments,
  type ReviewThread,
} from "@agent-native/core/client/review";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import { readDesignReviewSummary } from "@shared/review-summary";
import { IconMessageCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import { appendHitTestResponder } from "@/components/design/design-canvas/hit-test";
import { reviewThreadIdFromHash } from "@/components/design/review-link";
import { ReviewCommentsPanel } from "@/components/design/ReviewCommentsPanel";
import { QueryErrorState } from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ReviewCanvasPins,
  type ReviewFocusRequest,
} from "@/components/visual-editor/ReviewCanvasPins";

import { withLocalRuntimes } from "../components/design/design-canvas/local-runtime";
import {
  resolvePresentEscapeAction,
  shouldBlockPresentPageNavigation,
} from "./present-review-state";

interface DesignFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
}

interface DesignData {
  id: string;
  title: string;
  files: DesignFile[];
  accessRole?: "viewer" | "commenter" | "editor" | "admin" | "owner";
}

export default function Present() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reviewEmbed = searchParams.get("reviewEmbed") === "1";
  const { session } = useSession();
  const [currentPage, setCurrentPage] = useState(0);
  const [commentMode, setCommentMode] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reviewFocusRequest, setReviewFocusRequest] =
    useState<ReviewFocusRequest | null>(null);
  const reviewFocusNonceRef = useRef(0);
  const reviewLinkCommentIdRef = useRef<string | null>(null);

  const {
    data: design,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useActionQuery<DesignData>("get-design", { id: id! });

  useEffect(() => {
    if (!design) return;
    const nextTitle = `${normalizeDocumentTitle(
      design.title,
      "Untitled design",
    )} — Design`;
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) document.title = previousTitle;
    };
  }, [design]);

  const files: DesignFile[] = design?.files ?? [];
  const activeFile = files[currentPage] ?? files[0];
  const reviewQuery = useReviewComments(
    {
      resourceType: "design",
      resourceId: id ?? "",
      includeResolved: true,
      newestFirst: true,
      limit: 500,
    },
    { enabled: Boolean(id) && !reviewEmbed },
  );
  const canPost = Boolean(
    session?.email &&
    (design?.accessRole === "owner" ||
      design?.accessRole === "admin" ||
      design?.accessRole === "editor" ||
      design?.accessRole === "commenter"),
  );
  const canResolve = Boolean(
    design?.accessRole === "owner" ||
    design?.accessRole === "admin" ||
    design?.accessRole === "editor",
  );
  const reviewableContent = useMemo(
    () =>
      injectSessionReplayIframeBootstrap(
        appendHitTestResponder(activeFile?.content ?? ""),
      ),
    [activeFile?.content],
  );
  const reviewCommentCount =
    readDesignReviewSummary(reviewQuery.data)?.openCount ??
    new Set(
      (reviewQuery.data?.comments ?? [])
        .filter(
          (comment) =>
            comment.status === "open" && comment.parentCommentId === null,
        )
        .map((comment) => comment.threadId),
    ).size;
  const signInHref = buildSignInReturnHref(
    typeof window === "undefined"
      ? undefined
      : { returnTo: window.location.pathname },
  );

  const handleReviewThreadSelect = useCallback(
    (thread: ReviewThread) => {
      const targetIndex = files.findIndex(
        (file) => file.id === thread.root.targetId,
      );
      if (targetIndex >= 0) setCurrentPage(targetIndex);
      setCommentsOpen(false);
      setCommentMode(true);
      reviewFocusNonceRef.current += 1;
      setReviewFocusRequest({
        nonce: reviewFocusNonceRef.current,
        anchor: thread.root.anchor,
        targetId: thread.root.targetId ?? undefined,
        threadId: thread.root.threadId,
      });
    },
    [files],
  );

  useEffect(() => {
    if (reviewEmbed) return;
    const commentId =
      reviewThreadIdFromHash(location.hash) ?? searchParams.get("comment");
    const comments = reviewQuery.data?.comments ?? [];
    if (
      !commentId ||
      reviewLinkCommentIdRef.current === commentId ||
      !comments.length ||
      !design ||
      !files.length
    ) {
      return;
    }
    const thread = buildReviewThreads(comments).find(
      (candidate) =>
        candidate.root.id === commentId ||
        candidate.root.threadId === commentId ||
        candidate.replies.some((reply) => reply.id === commentId),
    );
    if (!thread) return;
    reviewLinkCommentIdRef.current = commentId;
    handleReviewThreadSelect(thread);
  }, [
    design,
    files.length,
    handleReviewThreadSelect,
    reviewQuery.data?.comments,
    location.hash,
    reviewEmbed,
    searchParams,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const action = resolvePresentEscapeAction(
          {
            commentsOpen,
            commentMode,
          },
          reviewEmbed,
        );
        if (action === "close-comments") setCommentsOpen(false);
        if (action === "exit-presentation") void navigate(`/design/${id}`);
        return;
      }
      if (shouldBlockPresentPageNavigation({ commentsOpen, commentMode }))
        return;
      if (files.length <= 1) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setCurrentPage((p) => Math.min(p + 1, files.length - 1));
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setCurrentPage((p) => Math.max(p - 1, 0));
      }
    },
    [commentMode, commentsOpen, files.length, id, navigate, reviewEmbed],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!id) {
    void navigate("/");
    return null;
  }

  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-black flex items-center justify-center p-10">
        <Skeleton className="h-full w-full max-w-5xl rounded-xl bg-white/5" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black p-10">
        <QueryErrorState onRetry={() => void refetch()} retrying={isFetching} />
      </div>
    );
  }

  if (!design || files.length === 0) {
    return (
      <div className="h-screen w-screen bg-black flex flex-col items-center justify-center gap-4">
        <p className="text-white/50 text-sm">{t("pages.presentEmpty")}</p>
        <Link
          to={`/design/${id}`}
          className="text-sm text-white/40 hover:text-white/60 underline cursor-pointer"
        >
          {t("pages.presentBackToEditor")}
        </Link>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <div className="present-review-canvas h-full w-full">
        <iframe
          {...{ [SESSION_REPLAY_IFRAME_ATTRIBUTE]: "" }}
          srcDoc={withLocalRuntimes(reviewableContent)}
          sandbox="allow-scripts"
          data-design-preview-iframe
          className="h-full w-full border-0"
          title={`${design.title} — ${activeFile.filename}`}
        />
        {!reviewEmbed ? (
          <ReviewCanvasPins
            active={commentMode}
            onClose={() => setCommentMode(false)}
            canvasSelector=".present-review-canvas"
            resourceType="design"
            resourceId={id}
            targetId={activeFile.id}
            canPost={canPost}
            canResolve={canResolve}
            currentUserEmail={session?.email}
            focusRequest={reviewFocusRequest}
          />
        ) : null}
      </div>

      {!reviewEmbed ? (
        <>
          <div className="fixed right-4 top-4 z-[70] flex items-center gap-2">
            <ReviewStatusBadge
              status={reviewQuery.data?.reviewStatus?.status ?? "draft"}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5 rounded-full bg-foreground/75 text-background shadow-lg hover:bg-foreground"
              onClick={() => {
                setCommentMode(false);
                setCommentsOpen(true);
              }}
            >
              <IconMessageCircle className="size-4" />
              {t("review.presentComments")}
              {reviewCommentCount > 0 ? ` · ${reviewCommentCount}` : ""}
            </Button>
          </div>

          <Sheet open={commentsOpen} onOpenChange={setCommentsOpen}>
            <SheetContent
              side="right"
              className="flex w-[min(92vw,380px)] flex-col overflow-hidden p-0"
            >
              <SheetHeader className="border-b border-border px-4 py-3">
                <SheetTitle className="flex items-center gap-2 text-sm">
                  <IconMessageCircle className="size-4" />
                  {t("review.presentComments")}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  {t("review.commentsTitle")}
                </SheetDescription>
              </SheetHeader>
              <ReviewCommentsPanel
                designId={id}
                canComment={canPost}
                canResolve={canResolve}
                currentTargetId={activeFile?.id ?? null}
                currentUserEmail={session?.email}
                canDeleteComment={(comment) =>
                  canResolve ||
                  ("canDelete" in comment && comment.canDelete === true) ||
                  comment.authorEmail === session?.email
                }
                signInHref={signInHref}
                onSelectThread={handleReviewThreadSelect}
                className="min-h-0 flex-1"
              />
              {canPost ? (
                <div className="shrink-0 border-t border-border p-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    onClick={() => {
                      setCommentsOpen(false);
                      setCommentMode(true);
                    }}
                  >
                    <IconMessageCircle className="size-3.5" />
                    {t("review.presentCommentMode")}
                  </Button>
                </div>
              ) : null}
            </SheetContent>
          </Sheet>
        </>
      ) : null}

      {/* Page indicator */}
      {files.length > 1 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 rounded-full px-3 py-1.5">
          {files.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={`w-2 h-2 rounded-full cursor-pointer ${
                i === currentPage ? "bg-white" : "bg-white/30"
              }`}
            />
          ))}
        </div>
      )}

      {/* Exit hint */}
      {!reviewEmbed ? (
        <div className="fixed left-4 top-4 text-xs text-foreground/20">
          {t("pages.presentExitHint")}
        </div>
      ) : null}
    </div>
  );
}
