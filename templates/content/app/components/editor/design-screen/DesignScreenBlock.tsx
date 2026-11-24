import type {
  BlockEditProps,
  BlockReadProps,
  BlockRenderContext,
  BlockSpec,
} from "@agent-native/core/blocks/server";
import { trackEvent } from "@agent-native/core/client/analytics";
import {
  callAction,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  designScreenBlockConfig,
  readDesignScreenData,
  type DesignScreenData,
} from "@shared/design-screen-block";
import { IconLayoutBoard, IconRefresh } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ImageLightbox, usePageImage } from "@/components/editor/ImageLightbox";
import { imageDisplaySrc } from "@/components/editor/private-media-src";
import { Button } from "@/components/ui/button";
import { SourceEmbedFrame } from "@/components/ui/source-embed-frame";

import { designScreenErrorMessage } from "./design-screen-errors";

type ContentBlockRenderContext = BlockRenderContext & {
  documentId?: string | null;
  canEdit?: boolean;
};

type CaptureResult =
  | { status: "captured"; screen: DesignScreenData }
  | { status: "needs_confirmation"; design: { title: string } };

const STATUS_STALE_MS = 5 * 60_000;

interface ScreenStatus {
  state: "changed" | "gone" | null;
  openComments: number;
}

function UnreadableScreen() {
  const t = useT();
  return (
    <div
      data-design-screen=""
      className="rounded-md border border-border p-4 text-sm text-muted-foreground"
    >
      {t("designScreen.unreadable")}
    </div>
  );
}

function focusScreenButton(image: HTMLImageElement) {
  image.closest("button")?.focus({ preventScroll: true });
  image.scrollIntoView({ block: "nearest" });
}

function ScreenPicture({
  image,
  alt,
  screenWidth,
}: {
  image: DesignScreenData["image"];
  alt: string;
  screenWidth: number;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pageImage, setPageImage] = usePageImage(focusScreenButton);
  const src = imageDisplaySrc(image.src);
  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className="rounded-md bg-muted p-4 text-sm text-muted-foreground"
      >
        {t("designScreen.imageFailed")}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        title={t("editor.media.expandImage")}
        onClick={() => setExpanded(true)}
        style={{ maxWidth: screenWidth }}
        className="mx-auto block w-full cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          ref={setPageImage}
          src={src}
          alt={alt}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="block h-auto w-full rounded-md border border-border/60"
        />
      </button>
      <ImageLightbox
        open={expanded}
        onOpenChange={setExpanded}
        src={src}
        alt={alt}
        origin={pageImage}
      />
    </>
  );
}

function DesignScreenView({
  data,
  status,
  forEditor,
  actions,
}: {
  data: DesignScreenData;
  status: ScreenStatus | null;
  forEditor?: boolean;
  actions?: React.ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const pinnedOn = useMemo(() => {
    const date = new Date(data.capturedAt);
    return Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
  }, [data.capturedAt, locale]);
  const meta = [
    t("designScreen.design", { design: data.design.title }),
    t("designScreen.width", { width: data.screen.width }),
    pinnedOn
      ? data.capturedBy
        ? t("designScreen.pinnedOnBy", {
            date: pinnedOn,
            name: data.capturedBy,
          })
        : t("designScreen.pinnedOn", { date: pinnedOn })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const notice =
    status?.state === "gone"
      ? t("designScreen.screenGone")
      : status?.state === "changed"
        ? t(forEditor ? "designScreen.changedRefresh" : "designScreen.changed")
        : null;
  const comments =
    status && status.state !== "gone" && status.openComments > 0 ? (
      <a
        href={data.screen.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackEvent("design_screen_comments_opened", {})}
        className="rounded-md px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {status.openComments === 1
          ? t("designScreen.openCommentsOne")
          : t("designScreen.openComments", { count: status.openComments })}
      </a>
    ) : null;
  return (
    <SourceEmbedFrame
      data-design-screen=""
      title={data.screen.name}
      meta={meta}
      href={data.screen.url}
      openLabel={t("designScreen.openInDesign")}
      onOpen={() => trackEvent("design_screen_opened", {})}
      actions={
        comments || actions ? (
          <>
            {comments}
            {actions}
          </>
        ) : undefined
      }
      notice={notice ?? undefined}
    >
      <ScreenPicture
        key={data.image.src}
        image={data.image}
        alt={t("designScreen.pictureAlt", {
          screen: data.screen.name,
          design: data.design.title,
          width: data.screen.width,
        })}
        screenWidth={data.screen.width}
      />
    </SourceEmbedFrame>
  );
}

function useScreenStatus(
  documentId: string | null | undefined,
  data: DesignScreenData,
  notBefore = 0,
): { status: ScreenStatus | null; recheck: () => void } {
  const { session } = useSession();
  const query = useActionQuery(
    "get-design-screen-status",
    {
      documentId: documentId ?? "",
      designs: [{ designId: data.design.id, screenIds: [data.screen.id] }],
    },
    {
      method: "POST",
      enabled: Boolean(
        session?.email && documentId && data.design.id && data.screen.id,
      ),
      retry: false,
      staleTime: STATUS_STALE_MS,
      refetchOnWindowFocus: false,
    },
  );
  const recheck = () => void query.refetch();
  const entry = query.data?.designs.find(
    (candidate) => candidate.designId === data.design.id,
  );
  const screen =
    entry && "status" in entry
      ? entry.status.screens.find(
          (candidate) => candidate.id === data.screen.id,
        )
      : undefined;
  if (!screen) return { status: null, recheck };
  return {
    status: {
      state:
        query.dataUpdatedAt < notBefore
          ? null
          : screen.fingerprint === null
            ? "gone"
            : screen.fingerprint !== data.screen.fingerprint
              ? "changed"
              : null,
      openComments: screen.openComments,
    },
    recheck,
  };
}

function DesignScreenReader({
  data,
  ctx,
}: {
  data: DesignScreenData;
  ctx: BlockRenderContext;
}) {
  const { documentId } = ctx as ContentBlockRenderContext;
  const { status } = useScreenStatus(documentId, data);
  return <DesignScreenView data={data} status={status} />;
}

function DesignScreenRead({ data, ctx }: BlockReadProps<DesignScreenData>) {
  const screen = useMemo(() => readDesignScreenData(data), [data]);
  return screen ? (
    <DesignScreenReader data={screen} ctx={ctx} />
  ) : (
    <UnreadableScreen />
  );
}

function DesignScreenEdit(props: BlockEditProps<DesignScreenData>) {
  const screen = useMemo(() => readDesignScreenData(props.data), [props.data]);
  return screen ? (
    <DesignScreenEditor {...props} data={screen} />
  ) : (
    <UnreadableScreen />
  );
}

function DesignScreenEditor({
  data,
  onChange,
  blockId,
  ctx,
}: BlockEditProps<DesignScreenData>) {
  const t = useT();
  const { documentId } = ctx as ContentBlockRenderContext;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const { status, recheck } = useScreenStatus(documentId, data, refreshedAt);

  const refresh = async (acknowledgeWiderAudience = false) => {
    if (!documentId || refreshing) return;
    setRefreshing(true);
    try {
      const result = (await callAction("capture-design-screen", {
        documentId,
        designId: data.design.id,
        screenId: data.screen.id,
        width: data.screen.width,
        purpose: "refresh",
        blockId,
        ...(acknowledgeWiderAudience ? { acknowledgeWiderAudience } : {}),
      })) as CaptureResult;
      if (result.status === "needs_confirmation") {
        toast.warning(
          t("designScreen.confirmWider", { design: result.design.title }),
          {
            action: {
              label: t("designScreen.refresh"),
              onClick: () => void refresh(true),
            },
          },
        );
        return;
      }
      onChange(result.screen);
      setRefreshedAt(Date.now());
      recheck();
      toast.success(t("designScreen.refreshed"));
    } catch (error) {
      toast.error(t("designScreen.refreshFailed"), {
        description: designScreenErrorMessage(error, t),
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <DesignScreenView
      data={data}
      status={status}
      forEditor
      actions={
        documentId && status?.state !== "gone" ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <IconRefresh
              className={refreshing ? "animate-spin" : undefined}
              aria-hidden
            />
            {refreshing
              ? t("designScreen.refreshing")
              : t("designScreen.refresh")}
          </Button>
        ) : null
      }
    />
  );
}

export const designScreenBlock: BlockSpec<DesignScreenData> = {
  ...designScreenBlockConfig,
  Read: DesignScreenRead,
  Edit: DesignScreenEdit,
  editSurface: "inline",
  icon: IconLayoutBoard,
};
