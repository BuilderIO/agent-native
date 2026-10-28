import type {
  BlockReadProps,
  BlockRenderContext,
  BlockSpec,
} from "@agent-native/core/blocks/server";
import { useT } from "@agent-native/core/client/i18n";
import {
  clipEmbedBlockConfig,
  type ClipEmbedData,
} from "@shared/clip-embed-block";
import type { ClipPlayback } from "@shared/clips-peer-contract";
import { IconMovie } from "@tabler/icons-react";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  clipMarginThreadId,
  setClipPlayhead,
  useClipCommentEmphasis,
  useClipCommentHostOf,
  useClipSeeker,
  usePublishClipComments,
  type ClipCommentSource,
  type ClipThreadView,
} from "./clip-comments";
import { youtubeEmbedSrc, type MediaState } from "./clip-media";
import {
  clearClipUpload,
  clipUploadPercent,
  failClipUpload,
  useClipUpload,
} from "./clip-uploads";
import { ClipPlayer } from "./ClipPlayer";
import { msToClock } from "./scrubber";
import {
  isClipBeingMade,
  useClipComments,
  useClipPlayback,
  type ClipPlaybackState,
  type ClipPlayerError,
} from "./use-clip-playback";
import {
  clipRecordingUrl,
  clipShareUrl,
  useClipsLinks,
} from "./use-clips-links";

type ContentBlockRenderContext = BlockRenderContext & {
  documentId?: string | null;
  canEdit?: boolean;
};

const ERROR_MESSAGES: Record<ClipPlayerError, string> = {
  clip_embed_disabled: "clipEmbed.disabled",
  document_not_found: "clipEmbed.notFound",
  clips_not_configured: "clipEmbed.notConfigured",
  clip_not_found: "clipEmbed.notFound",
  clip_expired: "clipEmbed.expired",
  clip_password_required: "clipEmbed.passwordRequired",
  clip_redaction_pending: "clipEmbed.redactionPending",
  clip_comments_disabled: "clipEmbed.failed",
  clip_comment_required: "clipEmbed.failed",
  clip_forbidden: "clipEmbed.forbidden",
  clip_token_refused: "clipEmbed.refused",
  clip_rate_limited: "clipEmbed.rateLimited",
  clips_unreachable: "clipEmbed.unreachable",
  refresh_failed: "clipEmbed.refreshFailed",
  unplayable: "clipEmbed.unplayable",
  failed: "clipEmbed.failed",
};

/** Failures that may clear up on their own, so the reader can ask again. */
const RETRYABLE = new Set<ClipPlayerError>([
  "clip_redaction_pending",
  "clip_rate_limited",
  "clips_unreachable",
  "refresh_failed",
  "unplayable",
  "failed",
]);

const NO_THREADS: ClipThreadView[] = [];

function ClipFrame({
  recordingId,
  commentThreadIds,
  emphasis = null,
  frameRef,
  children,
}: {
  recordingId: string;
  /** The margin's ids for the Clip's threads, which it places beside it. */
  commentThreadIds?: readonly string[];
  emphasis?: "pending" | "active" | null;
  frameRef?: (element: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={frameRef}
      className={cn(
        "media-block-wrapper",
        emphasis &&
          `comment-highlight comment-highlight--block comment-highlight--${emphasis}`,
      )}
      data-clip-embed={recordingId}
      data-clip-comment-threads={
        commentThreadIds?.length ? commentThreadIds.join(" ") : undefined
      }
    >
      <div className="media-block w-full">{children}</div>
    </div>
  );
}

/** The Blocks field tab an element is in; null is the page body. */
function blockFieldIdOf(element: Element | null): string | null {
  const panel = element?.closest("[data-block-field-panel]");
  if (!panel || panel.hasAttribute("data-primary-block-field-panel"))
    return null;
  return panel.getAttribute("data-block-field-id");
}

function ClipMessage({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="media-block__broken media-block__broken--fill"
      role="status"
    >
      <IconMovie className="media-block__broken-icon" aria-hidden />
      <div className="media-block__broken-copy">
        <span className="media-block__broken-title">{message}</span>
        {action}
      </div>
    </div>
  );
}

/** Takes a block out of the page it's in, as deleting it by hand would. */
function removeBlockFrom(element: HTMLElement | null, blockId: string) {
  const editor =
    element?.closest<TiptapEditorHTMLElement>(".ProseMirror")?.editor;
  if (!editor?.isEditable) return false;
  const ranges: Array<{ from: number; to: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (ranges.length > 0) return false;
    if (node.type.name === "registryBlock" && node.attrs.blockId === blockId) {
      ranges.push({ from: pos, to: pos + node.nodeSize });
      return false;
    }
    return true;
  });
  if (!ranges[0]) return false;
  editor.chain().focus().deleteRange(ranges[0]).run();
  return true;
}

/** A Clip whose file is still on its way to Clips, or being made there. */
function ClipBeingMade({
  label,
  percent,
  fileName,
  action,
}: {
  label: string;
  /** Null once the bytes are all sent, or when this tab didn't send them. */
  percent: number | null;
  fileName?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-muted"
      role="status"
      data-clip-upload={percent === null ? "making" : "uploading"}
    >
      <div className="flex w-64 max-w-full flex-col items-center gap-3 px-4 leading-normal">
        <div className="text-sm font-medium">{label}</div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
          <div
            className={
              percent === null
                ? "h-full w-full animate-pulse rounded-full bg-foreground/60"
                : "h-full rounded-full bg-foreground transition-[width] duration-200"
            }
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
        {fileName ? (
          <div className="max-w-full truncate text-xs text-muted-foreground">
            {fileName}
          </div>
        ) : null}
        {action}
      </div>
    </div>
  );
}

function ClipUploadUnfinished({
  recordingId,
  blockId,
  canRemove,
}: {
  recordingId: string;
  blockId: string;
  canRemove: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-clip-upload="failed">
      <ClipMessage
        message={t("clipEmbed.uploadUnfinished")}
        action={
          canRemove ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => {
                if (removeBlockFrom(ref.current, blockId)) {
                  clearClipUpload(recordingId);
                }
              }}
            >
              {t("clipEmbed.remove")}
            </Button>
          ) : null
        }
      />
    </div>
  );
}

function ClipCaption({
  grant,
  openUrl,
  trailing,
}: {
  grant: ClipPlayback;
  openUrl: string | null;
  trailing?: ReactNode;
}) {
  const t = useT();
  const title = grant.recording.title?.trim() || t("clipEmbed.untitled");
  const durationMs = grant.recording.durationMs;
  return (
    <div className="mt-2 flex items-center gap-1.5 text-sm leading-5 text-muted-foreground">
      <IconMovie className="size-4 shrink-0" aria-hidden />
      {openUrl ? (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={t("clipEmbed.openInClips")}
          className="truncate hover:text-foreground hover:underline"
        >
          {title}
        </a>
      ) : (
        <span className="truncate">{title}</span>
      )}
      {durationMs ? (
        <span className="shrink-0 tabular-nums">· {msToClock(durationMs)}</span>
      ) : null}
      <div className="flex-1" />
      {trailing}
    </div>
  );
}

export function ClipEmbed({
  documentId,
  recordingId,
  blockId,
  uploaded = false,
  canEdit = false,
}: {
  documentId: string;
  recordingId: string;
  blockId?: string;
  /** Uploaded into this page, rather than linked. */
  uploaded?: boolean;
  canEdit?: boolean;
}) {
  const t = useT();
  const tabUpload = useClipUpload(recordingId);
  // Only the page this tab uploaded the Clip into shows its progress.
  const upload = tabUpload?.documentId === documentId ? tabUpload : null;
  const playback = useClipPlayback(documentId, recordingId, {
    checkWhileMaking: upload?.phase !== "uploading",
  });
  const { grant } = playback;
  const status = grant?.recording.status ?? null;
  const placeRef = useRef<MediaState | null>(null);
  const links = useClipsLinks();
  const openUrl = links.appUrl ? clipShareUrl(links.appUrl, recordingId) : null;

  // The tab that uploaded the Clip says so once Clips has made it, or tells
  // the agent when Clips couldn't.
  const recordingUrl = links.appUrl
    ? clipRecordingUrl(links.appUrl, recordingId)
    : null;
  const uploadPhase = upload?.phase ?? null;
  useEffect(() => {
    if (!uploadPhase || uploadPhase === "uploading") return;
    if (status === "failed") {
      failClipUpload(recordingId);
      return;
    }
    if (status !== "ready") return;
    clearClipUpload(recordingId);
    toast.success(t("clipEmbed.savedAsClip"), {
      action: recordingUrl
        ? {
            label: t("clipEmbed.openInClips"),
            onClick: () =>
              window.open(recordingUrl, "_blank", "noopener,noreferrer"),
          }
        : undefined,
    });
  }, [recordingId, recordingUrl, status, t, uploadPhase]);

  const percent = upload ? clipUploadPercent(upload) : null;
  if (percent !== null) {
    return (
      <ClipFrame recordingId={recordingId}>
        <ClipBeingMade
          label={t("clipEmbed.uploadingPercent", { percent })}
          percent={percent}
          fileName={upload?.fileName}
        />
      </ClipFrame>
    );
  }
  const clipFailed = status === "failed";
  // This tab's send failing ends the upload even while Clips, which has no
  // way to know yet, still waits for the rest of the file.
  const sendFailed = upload?.phase === "failed" && status !== "processing";
  if ((uploaded && clipFailed) || (sendFailed && status !== "ready")) {
    return (
      <ClipFrame recordingId={recordingId}>
        <ClipUploadUnfinished
          recordingId={recordingId}
          blockId={blockId ?? ""}
          canRemove={canEdit && Boolean(blockId)}
        />
      </ClipFrame>
    );
  }
  // A check that failed while the Clip was being made says why, with Retry,
  // rather than leaving the block making it forever.
  const beingMade =
    (upload?.phase === "making" && status !== "ready") ||
    isClipBeingMade(grant);
  if (beingMade && !playback.error) {
    return (
      <ClipFrame recordingId={recordingId}>
        <ClipBeingMade
          label={
            status === "uploading" && !upload
              ? t("clipEmbed.uploading")
              : t("clipEmbed.making")
          }
          percent={null}
          fileName={upload?.fileName}
          action={
            playback.makingChecksStopped ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={playback.checkAgain}
              >
                {t("clipEmbed.gateCheckAgain")}
              </Button>
            ) : null
          }
        />
      </ClipFrame>
    );
  }
  return (
    <ClipEmbedPlayer
      documentId={documentId}
      recordingId={recordingId}
      playback={playback}
      openUrl={openUrl}
      resumeRef={placeRef}
    />
  );
}

/**
 * The Clip once it's made, or why it can't play. Its own component, so the
 * upload states above can return before its hooks run.
 */
function ClipEmbedPlayer({
  documentId,
  recordingId,
  playback,
  openUrl,
  resumeRef,
}: {
  documentId: string;
  recordingId: string;
  playback: ClipPlaybackState;
  openUrl: string | null;
  resumeRef: MutableRefObject<MediaState | null>;
}) {
  const t = useT();
  const { grant } = playback;
  const provider = grant?.recording.embedProvider ?? null;
  const youtubeSrc =
    provider === "youtube"
      ? youtubeEmbedSrc(grant?.playback.videoUrl ?? null)
      : null;
  // With comments off, Clips still shows its owner the comments it has.
  const comments = useClipComments(
    documentId,
    recordingId,
    Boolean(
      grant &&
      !provider &&
      (grant.recording.enableComments || grant.viewer.isOwner),
    ),
  );
  const listed = "threads" in comments;
  const threads = listed ? comments.threads : NO_THREADS;
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const fieldId = useMemo(() => blockFieldIdOf(frame), [frame]);
  const canComment = Boolean(grant?.viewer.canComment);
  const isOwner = Boolean(grant?.viewer.isOwner);
  const source = useMemo<ClipCommentSource | null>(
    () =>
      listed ? { recordingId, threads, canComment, isOwner, fieldId } : null,
    [canComment, fieldId, isOwner, listed, recordingId, threads],
  );
  usePublishClipComments(documentId, source);
  const host = useClipCommentHostOf(documentId);
  const commentThreadIds = useMemo(
    () => threads.map((thread) => clipMarginThreadId(recordingId, thread.id)),
    [recordingId, threads],
  );
  const emphasis = useClipCommentEmphasis(
    documentId,
    recordingId,
    commentThreadIds,
  );
  const [seek, setSeek] = useState<((ms: number) => void) | null>(null);
  useClipSeeker(documentId, recordingId, seek);
  const onSeekReady = useCallback(
    (next: ((ms: number) => void) | null) => setSeek(() => next),
    [],
  );
  const onPlayhead = useCallback(
    (ms: number) => setClipPlayhead(documentId, recordingId, ms),
    [documentId, recordingId],
  );
  const onOpenMarker = useCallback(
    (threadId: string) =>
      host?.openThread(clipMarginThreadId(recordingId, threadId)),
    [host, recordingId],
  );
  const onComment = useMemo(
    () =>
      host?.canCompose && canComment
        ? (ms: number) => host.compose(recordingId, ms)
        : undefined,
    [canComment, host, recordingId],
  );

  const openInClips = openUrl ? (
    <Button asChild variant="link" size="sm" className="h-auto px-0">
      <a href={openUrl} target="_blank" rel="noopener noreferrer">
        {t("clipEmbed.openInClips")}
      </a>
    </Button>
  ) : null;

  if (playback.error) {
    const error = playback.error;
    return (
      <ClipFrame recordingId={recordingId}>
        <ClipMessage
          message={t(ERROR_MESSAGES[error])}
          action={
            error === "clip_password_required" ? (
              openInClips
            ) : RETRYABLE.has(error) ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={playback.retry}
              >
                {t("clipEmbed.retry")}
              </Button>
            ) : null
          }
        />
      </ClipFrame>
    );
  }

  if (!grant) {
    return (
      <ClipFrame recordingId={recordingId}>
        <Skeleton
          role="status"
          aria-label={t("clipEmbed.loading")}
          className="w-full rounded-lg"
          style={{ aspectRatio: "16 / 9" }}
        />
      </ClipFrame>
    );
  }

  if (provider === "youtube" && youtubeSrc) {
    return (
      <ClipFrame recordingId={recordingId}>
        <div className="overflow-hidden rounded-lg bg-player-control">
          <iframe
            src={youtubeSrc}
            title={grant.recording.title ?? t("clipEmbed.untitled")}
            className="block aspect-video w-full"
            allow="encrypted-media; fullscreen; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        </div>
        <ClipCaption grant={grant} openUrl={openUrl} />
      </ClipFrame>
    );
  }

  if (provider || !grant.playback.videoUrl) {
    return (
      <ClipFrame recordingId={recordingId}>
        <ClipMessage
          message={t(
            provider ? "clipEmbed.playsInClipsOnly" : "clipEmbed.unplayable",
          )}
          action={openInClips}
        />
      </ClipFrame>
    );
  }

  return (
    <ClipFrame
      recordingId={recordingId}
      commentThreadIds={host ? commentThreadIds : undefined}
      emphasis={host ? emphasis : null}
      frameRef={setFrame}
    >
      <ClipPlayer
        grant={grant}
        markers={threads}
        onMediaError={playback.onMediaError}
        resumeRef={resumeRef}
        onSeekReady={onSeekReady}
        onPlayhead={onPlayhead}
        onOpenMarker={host ? onOpenMarker : undefined}
        onComment={onComment}
      />
      <ClipCaption
        grant={grant}
        openUrl={openUrl}
        trailing={
          comments.status === "failed" ? (
            <span className="shrink-0 text-xs">
              {t("clipEmbed.commentsFailed")}
            </span>
          ) : comments.status === "ready" && comments.truncated ? (
            <span className="shrink-0 text-xs">
              {t("clipEmbed.commentsTruncated", {
                count: comments.threads.length,
              })}
            </span>
          ) : null
        }
      />
    </ClipFrame>
  );
}

export function ClipEmbedRead({
  data,
  blockId,
  ctx,
}: BlockReadProps<ClipEmbedData>) {
  const t = useT();
  const documentId = (ctx as ContentBlockRenderContext).documentId;
  if (!documentId) {
    return (
      <ClipFrame recordingId={data.recordingId}>
        <ClipMessage message={t("clipEmbed.failed")} />
      </ClipFrame>
    );
  }
  // A grant answers one page's access check for one recording, and a node
  // view can outlive a page change, so a new page or recording is a new
  // player: nothing of the old grant carries over.
  const { canEdit } = ctx as ContentBlockRenderContext;
  return (
    <ClipEmbed
      key={`${documentId}\u0000${data.recordingId}`}
      documentId={documentId}
      recordingId={data.recordingId}
      blockId={blockId}
      uploaded={data.origin === "upload"}
      canEdit={canEdit === true}
    />
  );
}

export const clipEmbedBlock: BlockSpec<ClipEmbedData> = {
  ...clipEmbedBlockConfig,
  Read: ClipEmbedRead,
  editSurface: "none",
  icon: IconMovie,
};
