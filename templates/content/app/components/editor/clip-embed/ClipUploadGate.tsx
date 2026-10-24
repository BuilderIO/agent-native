import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { CLIP_EMBED_BLOCK_TYPE } from "@shared/clip-embed-block";
import {
  isClipUploadErrorCode,
  isContentClipUploadMimeType,
  type ClipUploadErrorCode,
  type ClipUploadTicket,
  type ContentClipStorage,
  type CreateClipUploadResult,
} from "@shared/clips-peer-contract";
import { IconFile, IconLoader2, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { createContentBlockId } from "../extensions/registryBlocks";
import { clipsStorageSetupUrls, useClipsLinks } from "./use-clips-links";

const UPLOAD_STATUS_RESOURCE = "clip-upload-status";

const UPLOAD_ERROR_MESSAGES: Record<ClipUploadErrorCode, string> = {
  clip_embed_disabled: "clipEmbed.disabled",
  document_not_found: "clipEmbed.notFound",
  document_edit_required: "clipEmbed.uploadEditRequired",
  clips_not_configured: "clipEmbed.notConfigured",
  clip_token_refused: "clipEmbed.refused",
  clip_rate_limited: "clipEmbed.rateLimited",
  clips_unreachable: "clipEmbed.unreachable",
};

function uploadErrorKey(error: unknown): string {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return isClipUploadErrorCode(code)
    ? UPLOAD_ERROR_MESSAGES[code]
    : "clipEmbed.uploadFailed";
}

function canUpload(storage: ContentClipStorage | undefined): boolean {
  return storage?.state === "ready" || storage?.state === "free";
}

/** Where this editor's uploads to the page would go, as Clips says. */
export function useClipUploadStorage(
  documentId: string | null | undefined,
  enabled: boolean,
) {
  return useActionQuery(
    "get-clip-upload-status",
    { documentId: documentId ?? "" },
    {
      enabled: enabled && Boolean(documentId),
      retry: false,
      staleTime: 30_000,
      resources: [UPLOAD_STATUS_RESOURCE],
    },
  );
}

export interface ClipUploadStarted {
  file: File;
  ticket: ClipUploadTicket;
  /** The id the page's Clip block must have: Clips bound the Clip to it. */
  blockId: string;
}

export interface HeldClipFile {
  file: File;
  storage: ContentClipStorage;
}

/**
 * Starts a video's upload to Clips. When Clips has nowhere to save it, the
 * file waits here, in this tab's memory only, and starts by itself once the
 * editor comes back with storage connected.
 */
export function useClipFileUpload(input: {
  documentId: string | null | undefined;
  onStarted: (started: ClipUploadStarted) => void;
}) {
  const t = useT();
  const { documentId } = input;
  const onStartedRef = useRef(input.onStarted);
  onStartedRef.current = input.onStarted;
  const [held, setHeld] = useState<HeldClipFile | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const start = useCallback(
    async (file: File) => {
      if (!documentId || busyRef.current) return;
      if (!isContentClipUploadMimeType(file.type)) {
        toast.error(t("clipEmbed.uploadType"));
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const blockId = createContentBlockId(CLIP_EMBED_BLOCK_TYPE);
      try {
        const result = await callAction<CreateClipUploadResult>(
          "create-clip-upload",
          {
            documentId,
            fileName: file.name,
            sizeBytes: file.size,
            mimeType: file.type,
            blockId,
          },
        );
        if (result.status === "started") {
          setHeld(null);
          onStartedRef.current({ file, ticket: result, blockId });
        } else if (result.status === "storage_required") {
          setHeld({ file, storage: result.storage });
        } else {
          setHeld(null);
          toast.error(
            t("clipEmbed.uploadTooLarge", {
              size: `${Math.floor(result.maxBytes / 1_000_000)} MB`,
            }),
          );
        }
      } catch (error) {
        toast.error(t(uploadErrorKey(error)));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [documentId, t],
  );

  const heldFile = held?.file ?? null;
  const checkAgain = useCallback(async () => {
    if (!documentId || !heldFile || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let storage: ContentClipStorage | null = null;
    try {
      storage = (
        await callAction<{ storage: ContentClipStorage }>(
          "get-clip-upload-status",
          { documentId },
        )
      ).storage;
    } catch (error) {
      toast.error(t(uploadErrorKey(error)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (!storage) return;
    if (canUpload(storage)) await start(heldFile);
    else setHeld({ file: heldFile, storage });
  }, [documentId, heldFile, start, t]);

  // Setup happens in a Clips tab, so coming back is the cue to look again.
  // Nothing checks while this tab is hidden.
  useEffect(() => {
    if (!heldFile) return;
    function onVisible() {
      if (document.visibilityState === "visible") void checkAgain();
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [heldFile, checkAgain]);

  return {
    held,
    busy,
    start,
    checkAgain,
    discard: () => setHeld(null),
  };
}

/** The Upload tab's note on where the video goes. */
export function ClipUploadHint({
  storage,
}: {
  storage: ContentClipStorage | undefined;
}) {
  const t = useT();
  const text =
    storage?.state === "free"
      ? storage.remaining === 1
        ? t("clipEmbed.savedAsClipFreeOne")
        : storage.remaining > 0
          ? t("clipEmbed.savedAsClipFree", { count: storage.remaining })
          : t("clipEmbed.savedAsClipFreeNone")
      : storage?.state === "used_up"
        ? t("clipEmbed.savedAsClipFreeNone")
        : t("clipEmbed.savedAsClip");
  return (
    <p className="text-center text-xs leading-4 text-muted-foreground">
      {text}
    </p>
  );
}

const GATE_COPY: Record<
  Exclude<ContentClipStorage["state"], "ready" | "free">,
  { titleKey: string; statusKey: string; whyKey: string }
> = {
  used_up: {
    titleKey: "clipEmbed.gateUsedUp",
    statusKey: "clipEmbed.gateUsedUpStatus",
    whyKey: "clipEmbed.gateWhy",
  },
  none: {
    titleKey: "clipEmbed.gateNone",
    statusKey: "clipEmbed.gateWaiting",
    whyKey: "clipEmbed.gateWhy",
  },
  account_required: {
    titleKey: "clipEmbed.gateAccount",
    statusKey: "clipEmbed.gateWaiting",
    whyKey: "clipEmbed.gateWhyAccount",
  },
};

/** A video waiting in its block for somewhere in Clips to save it. */
export function ClipUploadGate({
  held,
  busy,
  onCheckAgain,
  onDiscard,
}: {
  held: HeldClipFile;
  busy: boolean;
  onCheckAgain: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  const links = useClipsLinks();
  const setup = links.appUrl ? clipsStorageSetupUrls(links.appUrl) : null;
  // Clips can find room between the check and the start; the gate then
  // waits for the next one.
  const state = canUpload(held.storage) ? "none" : held.storage.state;
  const copy = GATE_COPY[state as keyof typeof GATE_COPY];
  const limit = held.storage.state === "used_up" ? held.storage.limit : 0;
  const size = `${(held.file.size / 1_000_000).toFixed(1)} MB`;

  return (
    <div
      className="w-full rounded-lg border border-border bg-card leading-normal"
      data-clip-upload-gate={state}
    >
      <div className="flex items-center gap-3 px-5 py-3.5">
        <IconFile className="size-5 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{held.file.name}</div>
          <div className="text-xs text-muted-foreground">
            {size} · {t(copy.statusKey, { limit })}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full text-muted-foreground"
          aria-label={t("clipEmbed.gateDiscard")}
          onClick={onDiscard}
        >
          <IconX className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-3 border-t border-border p-5">
        <div className="text-base font-semibold">{t(copy.titleKey)}</div>
        <div className="flex flex-wrap items-center gap-2">
          {setup && state === "account_required" ? (
            <Button asChild>
              <a href={setup.account} target="_blank" rel="noopener noreferrer">
                {t("clipEmbed.openClips")}
              </a>
            </Button>
          ) : setup ? (
            <>
              <Button asChild>
                <a
                  href={setup.builder}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("clipEmbed.connectBuilder")}
                </a>
              </Button>
              <Button asChild variant="secondary">
                <a
                  href={setup.customKeys}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("clipEmbed.customKeys")}
                </a>
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onCheckAgain}
          >
            {busy ? (
              <IconLoader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {t("clipEmbed.gateCheckAgain")}
          </Button>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-xs text-muted-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4"
              >
                {t("clipEmbed.gateWhyLabel")}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 whitespace-normal text-xs leading-relaxed">
              {t(copy.whyKey)}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
