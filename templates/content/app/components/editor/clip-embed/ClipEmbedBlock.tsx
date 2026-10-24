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
import { useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { youtubeEmbedSrc, type MediaState } from "./clip-media";
import { ClipPlayer } from "./ClipPlayer";
import { msToClock } from "./scrubber";
import {
  useClipMarkers,
  useClipPlayback,
  type ClipPlayerError,
} from "./use-clip-playback";
import { clipShareUrl, useClipsLinks } from "./use-clips-links";

type ContentBlockRenderContext = BlockRenderContext & {
  documentId?: string | null;
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

function ClipFrame({
  recordingId,
  children,
}: {
  recordingId: string;
  children: ReactNode;
}) {
  return (
    <div className="media-block-wrapper" data-clip-embed={recordingId}>
      <div className="media-block w-full">{children}</div>
    </div>
  );
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
}: {
  documentId: string;
  recordingId: string;
}) {
  const t = useT();
  const playback = useClipPlayback(documentId, recordingId);
  const { grant } = playback;
  const placeRef = useRef<MediaState | null>(null);
  const links = useClipsLinks();
  const openUrl = links.appUrl ? clipShareUrl(links.appUrl, recordingId) : null;
  const provider = grant?.recording.embedProvider ?? null;
  const youtubeSrc =
    provider === "youtube"
      ? youtubeEmbedSrc(grant?.playback.videoUrl ?? null)
      : null;
  const markers = useClipMarkers(
    documentId,
    recordingId,
    Boolean(grant?.recording.enableComments) && !provider,
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
    <ClipFrame recordingId={recordingId}>
      <ClipPlayer
        grant={grant}
        markers={"markers" in markers ? markers.markers : []}
        onMediaError={playback.onMediaError}
        resumeRef={placeRef}
      />
      <ClipCaption
        grant={grant}
        openUrl={openUrl}
        trailing={
          markers.status === "failed" ? (
            <span className="shrink-0 text-xs">
              {t("clipEmbed.commentsFailed")}
            </span>
          ) : markers.status === "ready" && markers.truncated ? (
            <span className="shrink-0 text-xs">
              {t("clipEmbed.commentsTruncated", {
                count: markers.markers.length,
              })}
            </span>
          ) : null
        }
      />
    </ClipFrame>
  );
}

export function ClipEmbedRead({ data, ctx }: BlockReadProps<ClipEmbedData>) {
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
  return (
    <ClipEmbed
      key={`${documentId}\u0000${data.recordingId}`}
      documentId={documentId}
      recordingId={data.recordingId}
    />
  );
}

export const clipEmbedBlock: BlockSpec<ClipEmbedData> = {
  ...clipEmbedBlockConfig,
  Read: ClipEmbedRead,
  editSurface: "none",
  icon: IconMovie,
};
