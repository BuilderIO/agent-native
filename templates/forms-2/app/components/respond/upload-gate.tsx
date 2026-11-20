import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import { useRef, useState, type ReactNode, type RefObject } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

/**
 * Runs an action only when file storage is set up. In the editor that is the
 * viewer's own storage, and a missing one opens the setup popover at `anchor`.
 * On a live form (`formId`) it is the form owner's storage: a respondent can't
 * connect one, so the popover only says uploads aren't available.
 */
export function useUploadGate(formId?: string | null): {
  anchor: RefObject<HTMLDivElement | null>;
  gate: (action: () => void) => void;
  popover: ReactNode;
} {
  const t = useT();
  const anchor = useRef<HTMLDivElement>(null);
  const anchorBox = useRef({
    getBoundingClientRect: () =>
      anchor.current?.getBoundingClientRect() ?? new DOMRect(),
  });
  const [setupOpen, setSetupOpen] = useState(false);
  const status = useFileUploadStatus(!formId);
  const ownerStatus = useActionQuery(
    "get-form-upload-status",
    { formId: formId ?? "" },
    { enabled: !!formId },
  );
  const configured = status.isSuccess && status.data.configured;
  const ownerReady = ownerStatus.data?.state === "available";
  const ownerUnavailable =
    ownerStatus.isError || ownerStatus.data?.state === "unavailable";
  const popover = formId ? (
    <Popover open={setupOpen && ownerUnavailable} onOpenChange={setSetupOpen}>
      <PopoverAnchor virtualRef={anchorBox} />
      <PopoverContent className="w-72">
        {t("forms.uploads.unavailable")}
      </PopoverContent>
    </Popover>
  ) : (
    <FileStorageSetupPopover
      open={setupOpen && !configured}
      onOpenChange={setSetupOpen}
      anchorRef={anchor}
      onConnected={() => void status.refetch()}
      {...(status.isError || status.isPending
        ? {
            status: "unavailable" as const,
            onRetry: () => void status.refetch(),
          }
        : { status: "missing" as const })}
    />
  );
  return {
    anchor,
    gate: (action) => {
      const ready = formId ? ownerReady : configured;
      return ready ? action() : setSetupOpen(true);
    },
    popover,
  };
}
