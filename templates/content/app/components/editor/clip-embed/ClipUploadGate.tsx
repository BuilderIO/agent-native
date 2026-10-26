import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { CLIP_EMBED_BLOCK_TYPE } from "@shared/clip-embed-block";
import {
  CLIP_UPLOAD_ERRORS,
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
import { cancelClipUpload } from "./clip-uploads";
import { clipsStorageSetupUrls, useClipsLinks } from "./use-clips-links";

const UPLOAD_STATUS_RESOURCE = "clip-upload-status";

/**
 * How long to wait before each repeat of a start Clips is still making, or
 * that got no answer.
 */
const STARTING_RETRY_MS = [2_000, 5_000, 10_000];

const UPLOAD_ERROR_MESSAGES: Record<ClipUploadErrorCode, string> = {
  clip_embed_disabled: "clipEmbed.disabled",
  document_not_found: "clipEmbed.notFound",
  document_edit_required: "clipEmbed.uploadEditRequired",
  clips_not_configured: "clipEmbed.notConfigured",
  clip_token_refused: "clipEmbed.refused",
  clip_rate_limited: "clipEmbed.rateLimited",
  clips_unreachable: "clipEmbed.unreachable",
  clip_upload_failed: "clipEmbed.uploadFailed",
};

function uploadErrorKey(error: unknown): string {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return isClipUploadErrorCode(code)
    ? UPLOAD_ERROR_MESSAGES[code]
    : "clipEmbed.uploadFailed";
}

/**
 * What a start that failed leaves the file to do. `retry`: Clips gave no
 * answer and may still have made the upload, so it goes again with the same
 * key, never a new one. `hold`: Clips refused for now and made nothing. Null:
 * a refusal that ends the pick.
 */
function afterFailedStart(error: unknown): "retry" | "hold" | null {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  if (
    !isClipUploadErrorCode(code) ||
    code === CLIP_UPLOAD_ERRORS.unreachable ||
    code === CLIP_UPLOAD_ERRORS.failed
  ) {
    return "retry";
  }
  return code === CLIP_UPLOAD_ERRORS.rateLimited ? "hold" : null;
}

/** Why a check on where uploads go failed: nothing has uploaded yet. */
function storageErrorKey(error: unknown): string {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return code === "clip_upload_failed"
    ? "clipEmbed.uploadStatusFailed"
    : uploadErrorKey(error);
}

/** 24 characters of `[A-Za-z0-9_-]`, as `CONTENT_CLIP_UPLOAD_KEY` takes. */
function newUploadKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
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
  recordingId: string;
  /** Null when an earlier start of this file already gave Clips all of it. */
  ticket: ClipUploadTicket | null;
  /** The id the page's Clip block must have: Clips bound the Clip to it. */
  blockId: string;
}

/**
 * A file the editor picked, with what every start of it sends. Its upload key
 * lives only here: every retry and Try again of the file sends it, so Clips
 * makes one recording however often the file starts. Remove, or a start
 * Clips answers, drops it.
 */
interface PickedClipFile {
  file: File;
  uploadKey: string;
  blockId: string;
}

/** A new pick of a file: its own key, and the id its Clip block will have. */
function newPick(file: File): PickedClipFile {
  return {
    file,
    uploadKey: newUploadKey(),
    blockId: createContentBlockId(CLIP_EMBED_BLOCK_TYPE),
  };
}

export type HeldClipFile = PickedClipFile &
  (
    | { storage: ContentClipStorage }
    /** No start of it got an answer from Clips; `failureKey` says why. */
    | { storage: null; failureKey: string }
  );

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
  // The held file as of now, not as of a render: Remove during a check or a
  // start must keep that file from uploading, or from coming back.
  const heldRef = useRef<HeldClipFile | null>(null);
  const hold = useCallback((next: HeldClipFile | null) => {
    heldRef.current = next;
    setHeld(next);
  }, []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Starting an upload can use a free clip, which the Upload tab counts.
  const { mutateAsync: startUpload } =
    useActionMutation<CreateClipUploadResult>("create-clip-upload", {
      resources: [UPLOAD_STATUS_RESOURCE],
    });

  const startPick = useCallback(
    async (pick: PickedClipFile) => {
      const { file, uploadKey, blockId } = pick;
      if (!documentId || busyRef.current) return;
      if (!isContentClipUploadMimeType(file.type)) {
        toast.error(t("clipEmbed.uploadType"));
        return;
      }
      busyRef.current = true;
      setBusy(true);
      const heldBefore = heldRef.current;
      try {
        const request = {
          documentId,
          fileName: file.name,
          sizeBytes: file.size,
          mimeType: file.type,
          blockId,
          uploadKey,
        };
        // A refusal from Clips ends the start at once.
        const attempt = () =>
          startUpload(request).then(
            (result) => ({ result }),
            (error: unknown) => {
              const next = afterFailedStart(error);
              if (!next) throw error;
              return { failure: error, retry: next === "retry" };
            },
          );
        let answer = await attempt();
        for (const wait of STARTING_RETRY_MS) {
          if (
            "result" in answer
              ? answer.result.status !== "starting"
              : !answer.retry
          ) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (heldRef.current !== heldBefore) return;
          answer = await attempt();
        }
        if (heldRef.current !== heldBefore) {
          if ("result" in answer && answer.result.status === "started") {
            void cancelClipUpload(answer.result);
          }
          return;
        }
        // Clips may still make an upload a start got no answer for, or is
        // still starting, so the file keeps its key for Try again.
        if (!("result" in answer) || answer.result.status === "starting") {
          hold({
            ...pick,
            storage: null,
            failureKey:
              "failure" in answer
                ? uploadErrorKey(answer.failure)
                : "clipEmbed.uploadFailed",
          });
          return;
        }
        const { result } = answer;
        if (
          result.status === "started" ||
          result.status === "already_finished"
        ) {
          hold(null);
          onStartedRef.current({
            file,
            recordingId: result.recordingId,
            ticket: result.status === "started" ? result : null,
            blockId,
          });
        } else if (result.status === "storage_required") {
          hold({ ...pick, storage: result.storage });
        } else if (result.status === "key_used") {
          // Clips refuses a key from here only once its upload ended: a start
          // it answers drops the pick, so no key whose upload goes on comes
          // back. A new key starts the file as a new upload.
          hold({
            ...newPick(file),
            storage: null,
            failureKey: "clipEmbed.uploadFailed",
          });
        } else if (result.status === "too_large") {
          hold(null);
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
    [documentId, hold, startUpload, t],
  );

  const start = useCallback(
    (file: File) => startPick(newPick(file)),
    [startPick],
  );

  const checkAgain = useCallback(async () => {
    const pick = heldRef.current;
    if (!documentId || !pick || busyRef.current) return;
    if (pick.storage === null) {
      await startPick(pick);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    let storage: ContentClipStorage | null = null;
    try {
      storage = (
        await callAction<{ storage: ContentClipStorage }>(
          "get-clip-upload-status",
          { documentId },
          { method: "GET" },
        )
      ).storage;
    } catch (error) {
      toast.error(t(storageErrorKey(error)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (!storage || heldRef.current !== pick) return;
    if (canUpload(storage)) await startPick(pick);
    else hold({ ...pick, storage });
  }, [documentId, hold, startPick, t]);

  const waitingFile = held?.storage ? held.file : null;

  // Setup happens in a Clips tab, so coming back is the cue to look again.
  // Nothing checks while this tab is hidden.
  useEffect(() => {
    if (!waitingFile) return;
    function onVisible() {
      if (document.visibilityState === "visible") void checkAgain();
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [waitingFile, checkAgain]);

  return {
    held,
    busy,
    start,
    checkAgain,
    discard: () => hold(null),
  };
}

/** The Upload tab's note on where the video goes. */
export function ClipUploadHint({
  storage,
  error,
}: {
  storage: ContentClipStorage | undefined;
  /** Why Clips couldn't say, when it couldn't. */
  error?: unknown;
}) {
  const t = useT();
  // Only where an upload would be saved as a Clip now; the gate explains the
  // rest once a file is picked.
  const text = error
    ? t(storageErrorKey(error))
    : storage?.state === "free"
      ? storage.remaining === 1
        ? t("clipEmbed.savedAsClipFreeOne")
        : storage.remaining > 0
          ? t("clipEmbed.savedAsClipFree", { count: storage.remaining })
          : t("clipEmbed.savedAsClipFreeNone")
      : storage?.state === "ready"
        ? t("clipEmbed.savedAsClip")
        : null;
  if (!text) return null;
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

/**
 * A video waiting in its block for somewhere in Clips to save it, or for
 * Clips to answer its start.
 */
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
  const state =
    held.storage === null
      ? "unanswered"
      : canUpload(held.storage)
        ? "none"
        : held.storage.state;
  const copy: { titleKey: string; statusKey?: string; whyKey?: string } =
    held.storage === null
      ? { titleKey: held.failureKey }
      : GATE_COPY[state as keyof typeof GATE_COPY];
  const limit = held.storage?.state === "used_up" ? held.storage.limit : 0;
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
            {copy.statusKey ? (
              <>
                {size} · {t(copy.statusKey, { limit })}
              </>
            ) : (
              size
            )}
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
          {state === "unanswered" ? null : setup &&
            state === "account_required" ? (
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
            {t(
              state === "unanswered"
                ? "clipEmbed.retry"
                : "clipEmbed.gateCheckAgain",
            )}
          </Button>
          <div className="flex-1" />
          {copy.whyKey ? (
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
