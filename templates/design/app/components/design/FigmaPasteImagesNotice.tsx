/**
 * Shown after a clipboard paste whose IMAGE fills could not be resolved. A
 * Figma clipboard carries image hashes, never bytes, so the fix is the original
 * `.fig` or a connected token. Collapsed it is one line of state; the two
 * choices and the opt-out live behind the expand, because most pastes are
 * geometry work where the missing photos do not matter yet.
 *
 * The expand is a popover rather than in-place content: a toast sits at the
 * bottom of the viewport and Sonner measures a custom toast once, so growing
 * this element pushed the choices off the bottom of the screen.
 */

import { useT } from "@agent-native/core/client/i18n";
import {
  IconBellOff,
  IconChevronDown,
  IconPhotoOff,
  IconPlugConnected,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  hydrateImagesFromFig,
  MAX_FIG_UPLOAD_MB,
  validateFigUploadFile,
} from "@/lib/design-file-upload";
import { cn } from "@/lib/utils";

interface FigmaPasteImagesNoticeProps {
  count: number;
  designId: string;
  fileIds: string[];
  onConnect: () => void;
  onDismissForever: () => void;
  onHydrated: () => void;
  onClose: () => void;
}

export function FigmaPasteImagesNotice({
  count,
  designId,
  fileIds,
  onConnect,
  onDismissForever,
  onHydrated,
  onClose,
}: FigmaPasteImagesNoticeProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const figInputRef = useRef<HTMLInputElement>(null);
  // Portal the popover into this toast rather than <body>: the toaster sits at
  // z-index 999999999 and a popover at 290 would render underneath any toast
  // still on screen -- including the success toast raised by the same import.
  const [noticeEl, setNoticeEl] = useState<HTMLDivElement | null>(null);

  async function handleFigSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = validateFigUploadFile(file);
    if (validationError) {
      toast.error(
        t(
          validationError === "too-large"
            ? "designEditor.import.errors.figFileTooLarge"
            : "designEditor.import.figmaHydrationInvalidFig",
          { max: MAX_FIG_UPLOAD_MB },
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const result = await hydrateImagesFromFig({
        designId,
        file,
        fileIds,
        fallbackErrorMessage: t("designEditor.import.figmaHydrationFigError"),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const resolved = result.totalResolved ?? 0;
      onHydrated();
      onClose();
      toast.success(t("designEditor.import.figmaHydrationSuccess"), {
        description: t(
          "designEditor.import.figmaHydrationFigSuccessDescription",
          { count: resolved, plural: resolved === 1 ? "" : "s" },
        ),
      });
    } catch (error) {
      // `hydrateImagesFromFig` rejects on transport, timeout, an unreadable
      // response or a failed chunk. Without this the rejection escaped
      // silently and left the notice sitting open with no explanation.
      toast.error(t("designEditor.import.figmaHydrationFigError"), {
        description:
          error instanceof Error ? error.message : t("common.genericError"),
      });
    } finally {
      setBusy(false);
    }
  }

  const rowClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-[background-color,opacity] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50";

  return (
    <div
      ref={setNoticeEl}
      className="w-full rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
    >
      <div className="flex items-center gap-2 px-1">
        <IconPhotoOff className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs">
          {t("designEditor.import.figmaPasteImagesNeedToken", {
            count,
            plural: count === 1 ? "" : "s",
          })}
        </span>
        <Popover open={expanded} onOpenChange={setExpanded}>
          <PopoverTrigger
            aria-label={t("designEditor.import.figmaHydrationDialogTitle")}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <IconChevronDown
              className={cn(
                "size-3.5 transition-transform duration-200 ease-[var(--ease-collapse)]",
                expanded && "rotate-180",
              )}
            />
          </PopoverTrigger>
          <PopoverContent
            container={noticeEl}
            side="top"
            align="end"
            sideOffset={8}
            className="w-56 origin-[--radix-popover-content-transform-origin] p-1"
          >
            <input
              ref={figInputRef}
              type="file"
              accept=".fig"
              className="hidden"
              onChange={(event) => void handleFigSelected(event)}
            />
            <button
              type="button"
              className={rowClass}
              disabled={busy}
              onClick={() => figInputRef.current?.click()}
            >
              <IconUpload className="size-3.5 shrink-0 text-muted-foreground" />
              {t("designEditor.import.figmaHydrationChooseFig")}
            </button>
            <button
              type="button"
              className={rowClass}
              disabled={busy}
              onClick={() => {
                onClose();
                onConnect();
              }}
            >
              <IconPlugConnected className="size-3.5 shrink-0 text-muted-foreground" />
              {t("designEditor.import.figmaHydrationConnectAndLoad")}
            </button>
            <button
              type="button"
              className={cn(rowClass, "text-muted-foreground")}
              onClick={() => {
                onDismissForever();
                onClose();
              }}
            >
              <IconBellOff className="size-3.5 shrink-0" />
              {t("designEditor.import.figmaPasteImagesDontShowAgain")}
            </button>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          aria-label={t("home.cancel")}
          onClick={onClose}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-[background-color,color] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <IconX className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
