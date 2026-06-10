import { useMemo, useState, type ReactNode } from "react";
import { IconLink, IconMail, IconCode } from "@tabler/icons-react";
import { appPath, useActionQuery } from "@agent-native/core/client";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CopyField,
  GeneralAccessSelect,
  MakePublicCard,
  ShareCardHeader,
  SharePeopleTab,
  VIS_META,
  copyToClipboard,
  useResourceVisibilityMutation,
  type SharesQuery,
  type SharesResponse,
  type Visibility,
} from "@/components/sharing/share-ui";

const PUBLIC_DESCRIPTION =
  "Anyone with the link can view — sign in to comment or react";

function absoluteAppUrl(path: string): string {
  if (typeof window === "undefined") return "";
  return new URL(appPath(path), window.location.origin).toString();
}

export interface ShareRecordingPopoverProps {
  recordingId: string;
  recordingTitle?: string;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  /** Trigger element rendered as the popover anchor (usually the Share button). */
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type ShareRecordingDialogProps = Omit<
  ShareRecordingPopoverProps,
  "children"
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Clips share popover — anchored to a trigger button, contains Link /
 * Invite / Embed tabs with the same functionality as the framework share
 * dialog, plus Clips-specific extras (GIF preview + MP4 download) and a
 * recording-aware embed configurator (autoplay, start time, responsive /
 * fixed size).
 */
export function ShareRecordingPopover({
  recordingId,
  recordingTitle,
  videoUrl,
  animatedThumbnailUrl,
  children,
  open,
  onOpenChange,
}: ShareRecordingPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[440px] max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        <ShareRecordingContent
          recordingId={recordingId}
          recordingTitle={recordingTitle}
          videoUrl={videoUrl}
          animatedThumbnailUrl={animatedThumbnailUrl}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Dialog shell for menu-driven Share actions. Radix popovers need a real
 * anchor; opening one from a dropdown item with an invisible trigger can
 * be dismissed by the same click/focus cycle that closes the menu.
 */
export function ShareRecordingDialog({
  recordingId,
  recordingTitle,
  videoUrl,
  animatedThumbnailUrl,
  open,
  onOpenChange,
}: ShareRecordingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-[440px]">
        <DialogTitle className="sr-only">
          {recordingTitle ? `Share ${recordingTitle}` : "Share recording"}
        </DialogTitle>
        <ShareRecordingContent
          recordingId={recordingId}
          recordingTitle={recordingTitle}
          videoUrl={videoUrl}
          animatedThumbnailUrl={animatedThumbnailUrl}
          reserveCloseButton
        />
      </DialogContent>
    </Dialog>
  );
}

function ShareRecordingContent({
  recordingId,
  recordingTitle,
  videoUrl,
  animatedThumbnailUrl,
  reserveCloseButton = false,
}: {
  recordingId: string;
  recordingTitle?: string;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  reserveCloseButton?: boolean;
}) {
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/share/${recordingId}`;

  const sharesQuery = useActionQuery<SharesResponse>("list-resource-shares", {
    resourceType: "recording",
    resourceId: recordingId,
  });

  const data = sharesQuery.data;
  const canManage = data?.role === "owner" || data?.role === "admin";
  const titleText = recordingTitle
    ? `Share "${recordingTitle}"`
    : "Share recording";

  return (
    <>
      <ShareCardHeader
        title={titleText}
        ownerEmail={data?.ownerEmail}
        reserveCloseButton={reserveCloseButton}
      />

      <Tabs defaultValue="link" className="min-w-0 px-4 py-3">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="link" className="gap-1.5">
            <IconLink size={14} />
            Link
          </TabsTrigger>
          <TabsTrigger value="invite" className="gap-1.5">
            <IconMail size={14} />
            Invite
          </TabsTrigger>
          <TabsTrigger value="embed" className="gap-1.5">
            <IconCode size={14} />
            Embed
          </TabsTrigger>
        </TabsList>

        <TabsContent value="link" className="mt-3">
          <LinkTab
            recordingId={recordingId}
            shareUrl={shareUrl}
            sharesQuery={sharesQuery}
            canManage={canManage}
            videoUrl={videoUrl}
            animatedThumbnailUrl={animatedThumbnailUrl}
          />
        </TabsContent>

        <TabsContent value="invite" className="mt-3">
          <SharePeopleTab
            resourceType="recording"
            resourceId={recordingId}
            resourceUrl={absoluteAppUrl(`/r/${recordingId}`)}
            sharesQuery={sharesQuery}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="embed" className="mt-3">
          <ClipsEmbedConfigurator
            recordingId={recordingId}
            sharesQuery={sharesQuery}
            canManage={canManage}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------
// Link tab — visibility + copy link + Clips extras (GIF / MP4)
// ---------------------------------------------------------------------------

function LinkTab({
  recordingId,
  shareUrl,
  sharesQuery,
  canManage,
  videoUrl,
  animatedThumbnailUrl,
}: {
  recordingId: string;
  shareUrl: string;
  sharesQuery: SharesQuery;
  canManage: boolean;
  videoUrl?: string | null;
  animatedThumbnailUrl?: string | null;
}) {
  const { setResourceVisibility, isPending } = useResourceVisibilityMutation(
    "recording",
    recordingId,
    sharesQuery,
  );
  const data = sharesQuery.data;
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const isPublic = visibility === "public";

  return (
    <div className="space-y-4">
      <GeneralAccessSelect
        visibility={visibility}
        canManage={canManage}
        isPending={isPending}
        onChange={(next) => setResourceVisibility(next)}
        publicDescription={PUBLIC_DESCRIPTION}
      />

      <CopyField
        label="Share link"
        value={shareUrl}
        disabled={isPending || (!isPublic && canManage)}
      />

      {!isPublic && canManage ? (
        <MakePublicCard
          isPending={isPending}
          onMakePublic={() =>
            setResourceVisibility("public", {
              onSuccess: () => copyToClipboard(shareUrl),
            })
          }
        />
      ) : null}

      {videoUrl || animatedThumbnailUrl ? (
        <div className="flex flex-wrap gap-2">
          {animatedThumbnailUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(animatedThumbnailUrl, "_blank")}
            >
              GIF preview
            </Button>
          ) : null}
          {videoUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(videoUrl, "_blank")}
            >
              Download MP4
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embed tab — Clips-specific configurator
// ---------------------------------------------------------------------------

function ClipsEmbedConfigurator({
  recordingId,
  sharesQuery,
  canManage,
}: {
  recordingId: string;
  sharesQuery: SharesQuery;
  canManage: boolean;
}) {
  const [autoplay, setAutoplay] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [mode, setMode] = useState<"responsive" | "fixed">("responsive");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(360);

  const data = sharesQuery.data;
  const visibility: Visibility =
    (data?.visibility as Visibility | null) ?? "private";
  const isPublic = visibility === "public";
  const { setResourceVisibility, isPending } = useResourceVisibilityMutation(
    "recording",
    recordingId,
    sharesQuery,
  );
  const makePublic = () => setResourceVisibility("public");

  const src = useMemo(() => {
    const params: string[] = [];
    if (autoplay) params.push("autoplay=1");
    if (startMs > 0) params.push(`t=${Math.round(startMs / 1000)}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return absoluteAppUrl(`/embed/${recordingId}${qs}`);
  }, [recordingId, autoplay, startMs]);

  const code =
    mode === "responsive"
      ? `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${src}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture" style="position:absolute;inset:0;width:100%;height:100%"></iframe></div>`
      : `<iframe src="${src}" width="${width}" height="${height}" frameborder="0" allowfullscreen allow="autoplay; picture-in-picture"></iframe>`;

  return (
    <div className="space-y-3">
      {!isPublic ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs">
          <div className="font-medium text-foreground">
            Embeds need a public clip
          </div>
          <p className="mt-0.5 text-muted-foreground">
            This clip is currently{" "}
            <span className="font-medium">{VIS_META[visibility].label}</span>.
            Embedded iframes load anonymously, so the clip must be public for
            viewers to watch.
          </p>
          {canManage ? (
            <Button
              size="sm"
              className="mt-2 h-7"
              onClick={makePublic}
              disabled={isPending}
            >
              {isPending ? "Making public…" : "Make public"}
            </Button>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Ask the owner to make it public.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "responsive"}
            onChange={() => setMode("responsive")}
          />
          Responsive (16:9)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "fixed"}
            onChange={() => setMode("fixed")}
          />
          Fixed size
        </label>
      </div>

      {mode === "fixed" ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">Width</Label>
            <Input
              type="number"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || 640)}
            />
          </div>
          <div className="flex-1">
            <Label className="text-xs">Height</Label>
            <Input
              type="number"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value) || 360)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <Label className="text-sm">Autoplay</Label>
        <Switch checked={autoplay} onCheckedChange={setAutoplay} />
      </div>

      <div>
        <Label className="text-xs">Start at (seconds)</Label>
        <Input
          type="number"
          min={0}
          value={Math.round(startMs / 1000)}
          onChange={(e) => setStartMs((parseInt(e.target.value) || 0) * 1000)}
        />
      </div>

      <div>
        <Label className="text-xs mb-1 block">Embed code</Label>
        <textarea
          readOnly
          value={code}
          className="w-full h-20 px-3 py-2 text-xs font-mono rounded-md border border-input bg-background resize-none"
        />
      </div>
    </div>
  );
}
