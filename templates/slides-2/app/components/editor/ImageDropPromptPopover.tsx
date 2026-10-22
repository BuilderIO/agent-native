import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { appBasePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  PromptComposer,
  type TiptapComposerHandle,
} from "@agent-native/toolkit/app/chat/composer/index";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { UploadStorageGate } from "@/components/editor/UploadStorageGate";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";
import {
  assetErrorTranslationKey,
  isAssetStorageSetupError,
} from "@/lib/asset-error-copy";
import {
  canInlineImageFile,
  buildImageDropAgentPayload,
  readFileAsDataUrl,
  type HostedImageUploadResult,
} from "@/lib/image-drop-to-agent";
import { parseUploadResponse } from "@/lib/upload-response";

interface ImageDropPromptPopoverProps {
  open: boolean;
  file: File | null;
  position: { x: number; y: number } | null;
  contextHint?: string;
  onClose: () => void;
}

export default function ImageDropPromptPopover({
  open,
  file,
  position,
  contextHint,
  onClose,
}: ImageDropPromptPopoverProps) {
  const t = useT();
  const storageQuery = useSlideFileStorageStatus(open);
  const fileStorageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const [uploading, setUploading] = useState(false);
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<TiptapComposerHandle>(null);
  const virtualAnchor = useMemo(
    () => ({
      current: {
        get contextElement() {
          return document.body;
        },
        getBoundingClientRect: () =>
          new DOMRect(
            position?.x ?? window.innerWidth / 2,
            position?.y ?? window.innerHeight / 2,
            0,
            0,
          ),
      },
    }),
    [position],
  );

  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!open) setUploading(false);
  }, [open]);

  if (!file) return null;

  const handleSubmit = async (intent: string) => {
    if (!file) return;
    if (!fileStorageConfigured) {
      setStoragePromptOpen(true);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body: form,
      });
      let data: {
        url?: string;
        errorCode?: string;
      };
      try {
        data = await parseUploadResponse(res, t("raw.imageUploadGenericError"));
      } catch (error) {
        const errorCode = (error as { errorCode?: unknown })?.errorCode;
        throw new Error(
          t(`raw.assetErrors.${assetErrorTranslationKey(errorCode, "upload")}`),
        );
      }
      const upload: HostedImageUploadResult = {
        ok: res.ok && !!data.url,
        status: res.status,
        url: data.url,
        errorCode: data.errorCode,
        error: t(
          `raw.assetErrors.${assetErrorTranslationKey(data.errorCode, "upload")}`,
        ),
      };

      const dataUrl = canInlineImageFile(file)
        ? await readFileAsDataUrl(file)
        : undefined;

      if (!upload.ok && isAssetStorageSetupError(upload.errorCode)) {
        await storageQuery.refetch();
        setStoragePromptOpen(true);
        return;
      }

      const payload = buildImageDropAgentPayload({
        intent,
        contextHint,
        filename: file.name,
        upload,
        dataUrl,
      });

      if (payload.kind === "hosted") {
        sendToAgentChat({
          message: payload.message,
          context: payload.context,
          submit: true,
          referenceImagePaths: payload.referenceImagePaths,
          images: payload.images,
        });
      } else {
        sendToAgentChat({
          message: payload.message,
          context: payload.context,
          submit: true,
          images: payload.images,
        });
      }

      onClose();
      toast.success(t("raw.sentToAgent"), {
        description: file.name,
      });
    } catch (err) {
      const errorCode = (err as { errorCode?: unknown })?.errorCode;
      toast.error(t("raw.imageUploadFailed"), {
        description: t(
          `raw.assetErrors.${assetErrorTranslationKey(errorCode, "upload")}`,
        ),
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <PopoverAnchor virtualRef={virtualAnchor} />
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={12}
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        aria-label={t("raw.imagePromptTitle")}
        className="w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl p-0 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-2 px-3.5 pb-2 pt-3">
          <h2 className="text-sm font-medium text-foreground/90">
            {t("raw.imagePromptTitle")}
          </h2>
          <Button
            type="button"
            onClick={onClose}
            variant="ghost"
            size="icon"
            aria-label={t("comments.close")}
          >
            <IconX className="size-3.5" />
          </Button>
        </div>

        {previewUrl && (
          <div className="px-3 pb-2">
            <div className="overflow-hidden rounded-md border border-border bg-muted/40">
              <img
                src={previewUrl}
                alt={file.name}
                className="block max-h-40 w-full object-contain"
              />
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {file.name}
            </p>
          </div>
        )}

        <div ref={panelRef} className="px-3 pb-3">
          <PromptComposer
            composerRef={composerRef}
            autoFocus
            attachmentsEnabled={false}
            showModelSelector={false}
            voiceEnabled={false}
            plusMenuMode="hidden"
            layoutVariant="compact"
            ariaLabel={t("raw.imagePromptTitle")}
            placeholder={t("raw.imagePromptPlaceholder")}
            preserveDraftOnSubmit
            disabled={uploading}
            submitting={uploading}
            onSubmit={(text) => handleSubmit(text)}
            onEmptySubmit={() => handleSubmit("")}
            actionButton={
              <Button
                type="button"
                size="sm"
                onClick={() => void composerRef.current?.submit?.()}
                disabled={uploading}
              >
                {uploading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <IconLoader2 className="size-3.5 animate-spin" />
                    {t("raw.uploading")}
                  </span>
                ) : (
                  t("raw.sendToAgent")
                )}
              </Button>
            }
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={uploading}
            >
              {t("slideTextMenu.cancel")}
            </Button>
          </div>
        </div>
        <UploadStorageGate
          configured={fileStorageConfigured}
          unavailable={!storageQuery.isSuccess}
          open={storagePromptOpen}
          onOpenChange={setStoragePromptOpen}
          onRetry={() => void storageQuery.refetch()}
          anchorRef={panelRef}
        />
      </PopoverContent>
    </Popover>
  );
}
