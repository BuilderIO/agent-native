import {
  ReviewStatusBadge,
  agentNativePath,
  useActionQuery,
  useReviewComments,
  useSession,
  useT,
} from "@agent-native/core/client";
import { readDesignReviewSummary } from "@shared/review-summary";
import { IconMessageCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router";

import { appendHitTestResponder } from "@/components/design/design-canvas/hit-test";
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
import { ReviewCanvasPins } from "@/components/visual-editor/ReviewCanvasPins";

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
  accessRole?: "viewer" | "editor" | "admin" | "owner";
}

export default function Present() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const [currentPage, setCurrentPage] = useState(0);
  const [commentMode, setCommentMode] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const {
    data: design,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useActionQuery<DesignData>("get-design", { id: id! });

  const files: DesignFile[] = design?.files ?? [];
  const activeFile = files[currentPage] ?? files[0];
  const reviewQuery = useReviewComments(
    {
      resourceType: "design",
      resourceId: id ?? "",
      targetId: activeFile?.id ?? undefined,
      includeResolved: false,
      limit: 500,
    },
    { enabled: Boolean(id) },
  );
  const canPost = Boolean(session?.email);
  const canResolve = Boolean(
    design?.accessRole === "owner" ||
    design?.accessRole === "admin" ||
    design?.accessRole === "editor",
  );
  const reviewableContent = useMemo(
    () => appendHitTestResponder(activeFile?.content ?? ""),
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
  const signInHref = (() => {
    const base = agentNativePath("/_agent-native/sign-in");
    if (typeof window === "undefined") return base;
    const returnUrl = new URL(window.location.href);
    returnUrl.search = "";
    returnUrl.hash = "";
    return `${base}?return=${encodeURIComponent(returnUrl.pathname)}`;
  })();

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const action = resolvePresentEscapeAction({
          commentsOpen,
          commentMode,
        });
        if (action === "close-comments") setCommentsOpen(false);
        if (action === "exit-presentation") navigate(`/design/${id}`);
        // ReviewCanvasPins owns "defer-to-comment-mode" so it can dismiss an
        // active draft before it exits the tool.
        return;
      }
      // Freeze slide navigation while review UI is active so typing a space
      // or using arrow keys in the sheet cannot change the anchored screen.
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
    [commentMode, commentsOpen, files.length, id, navigate],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!id) {
    navigate("/");
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
        <button
          onClick={() => navigate(`/design/${id}`)}
          className="text-sm text-white/40 hover:text-white/60 underline cursor-pointer"
        >
          {t("pages.presentBackToEditor")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <div className="present-review-canvas h-full w-full">
        <iframe
          srcDoc={reviewableContent}
          sandbox="allow-scripts"
          data-design-preview-iframe
          className="h-full w-full border-0"
          title={`${design.title} — ${activeFile.filename}`}
        />
        <ReviewCanvasPins
          active={commentMode}
          onClose={() => setCommentMode(false)}
          canvasSelector=".present-review-canvas"
          resourceType="design"
          resourceId={id}
          targetId={activeFile.id}
          canPost={canPost}
          canResolve={canResolve}
        />
      </div>

      <div className="fixed right-4 top-4 z-[70] flex items-center gap-2">
        <ReviewStatusBadge
          status={reviewQuery.data?.reviewStatus?.status ?? "draft"}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5 rounded-full bg-black/75 text-white shadow-lg hover:bg-black"
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
            activeFileId={activeFile.id}
            canComment={canPost}
            canResolve={canResolve}
            canDeleteComment={(comment) =>
              canResolve ||
              ("canDelete" in comment && comment.canDelete === true) ||
              comment.authorEmail === session?.email
            }
            showComposer={false}
            signInHref={signInHref}
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
      <div className="fixed left-4 top-4 text-xs text-white/20">
        {t("pages.presentExitHint")}
      </div>
    </div>
  );
}
