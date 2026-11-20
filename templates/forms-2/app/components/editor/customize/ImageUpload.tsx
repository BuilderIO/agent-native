import { useT } from "@agent-native/core/client/i18n";
import {
  uploadEditorImage,
  useFileUploadStatus,
} from "@agent-native/core/client/uploads";
import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import { IconLoader2, IconPhoto, IconX } from "@tabler/icons-react";
import { useRef, useState, type ReactNode } from "react";

import { sonnerToast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

/**
 * Uploads through the framework's file storage and reports only the hosted URL.
 * `children` replaces the icon, e.g. a text label for the wide variant.
 */
export function ImageUpload({
  uploadLabel,
  removeLabel,
  url,
  onUploaded,
  onRemove,
  className,
  children,
}: {
  uploadLabel: string;
  removeLabel: string;
  url: string | undefined;
  onUploaded: (url: string) => void;
  onRemove: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const status = useFileUploadStatus();
  const configured = status.isSuccess && status.data.configured;

  function requestUpload() {
    if (configured) input.current?.click();
    else setSetupOpen(true);
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      onUploaded((await uploadEditorImage(file)).src);
    } catch {
      sonnerToast.error(t("forms.customize.uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root} className={cn("relative", className)}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-testid="image-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        aria-label={uploadLabel}
        disabled={busy}
        onClick={requestUpload}
        className="flex h-[29px] w-full items-center justify-center gap-1.5 overflow-hidden rounded-md border border-input bg-background text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        {busy ? (
          <IconLoader2 className="size-4 animate-spin" />
        ) : url && !children ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <IconPhoto className="size-4 shrink-0" />
        )}
        {children}
      </button>
      <FileStorageSetupPopover
        open={setupOpen && !configured}
        onOpenChange={setSetupOpen}
        anchorRef={root}
        onConnected={() => void status.refetch()}
        {...(status.isError || status.isPending
          ? {
              status: "unavailable" as const,
              onRetry: () => void status.refetch(),
            }
          : { status: "missing" as const })}
      />
      {url ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-input bg-background text-muted-foreground shadow-sm hover:text-foreground"
        >
          <IconX className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
