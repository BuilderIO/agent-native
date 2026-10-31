import { useT } from "@agent-native/core/client/i18n";
import { IconLoader2, IconUpload } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { UploadStorageGate } from "@/components/editor/UploadStorageGate";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";

import { DECK_FILE_ACCEPT, type usePromptImport } from "./use-prompt-import";

const DECK_IMPORT_ACCEPT = Object.values(DECK_FILE_ACCEPT).join(",");

export function ImportDeckButton({
  controller,
}: {
  controller: ReturnType<typeof usePromptImport>;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [popover, setPopover] = useState<"error" | "storage" | null>(null);
  const busy = controller.importingSource !== null;
  const storageQuery = useSlideFileStorageStatus();
  const fileStorageConfigured =
    storageQuery.isSuccess && storageQuery.data.configured === true;
  const openPicker = () => {
    if (busy) return;
    if (!fileStorageConfigured) {
      setPopover("storage");
      return;
    }
    if (!input.current) return;
    input.current.value = "";
    controller.clear();
    setPopover(null);
    input.current.click();
  };
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    if (!fileStorageConfigured) {
      setPopover("storage");
      return;
    }
    void controller.importFile(file).then((done) => {
      if (!done) setPopover("error");
    });
  };

  useEffect(() => {
    if (popover === "storage" && fileStorageConfigured) setPopover(null);
  }, [fileStorageConfigured, popover]);
  return (
    <Popover
      open={popover === "error"}
      onOpenChange={(open) => !open && !busy && setPopover(null)}
    >
      <PopoverAnchor asChild>
        <div className="inline-flex shrink-0 items-center gap-2">
          <Button
            ref={trigger}
            type="button"
            size="sm"
            disabled={busy}
            aria-busy={busy}
            aria-label={t(
              busy ? "editorToolbar.importing" : "home.importMenu.import",
            )}
            onClick={openPicker}
          >
            {busy ? (
              <IconLoader2 className="motion-safe:animate-spin" />
            ) : (
              <IconUpload />
            )}
            <span className="slides-home-import-label">
              {t(busy ? "editorToolbar.importing" : "home.importMenu.import")}
            </span>
          </Button>
          <span
            className="slides-home-import-status sr-only text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {busy ? t("editorToolbar.importing") : ""}
          </span>
        </div>
      </PopoverAnchor>
      <input
        ref={input}
        type="file"
        hidden
        disabled={busy || !fileStorageConfigured}
        aria-label={t("editorToolbar.importFile")}
        accept={DECK_IMPORT_ACCEPT}
        onChange={handleFileChange}
      />
      <PopoverContent
        align="end"
        className="w-[min(28rem,calc(100vw-2rem))]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
        aria-label={t("home.importMenu.import")}
      >
        <div className="grid gap-3">
          <p role="alert" className="text-sm text-destructive">
            {controller.error}
          </p>
          {controller.retrySelection && (
            <Button
              disabled={busy}
              onClick={() => {
                if (controller.retrySelection)
                  void controller
                    .runImport(controller.retrySelection)
                    .then((done) => {
                      if (done) setPopover(null);
                    });
              }}
            >
              {t(busy ? "editorToolbar.importing" : "home.retry")}
            </Button>
          )}
        </div>
      </PopoverContent>
      <UploadStorageGate
        configured={fileStorageConfigured}
        unavailable={!storageQuery.isSuccess}
        open={popover === "storage"}
        onOpenChange={(open) => !open && setPopover(null)}
        onRetry={() => void storageQuery.refetch()}
      />
    </Popover>
  );
}
