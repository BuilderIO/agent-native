import { toast } from "sonner";

import type { IframeImagePasteSkipped } from "@/components/design/design-canvas/iframe-events";
import {
  MAX_IMAGE_PASTE_FILE_MB,
  MAX_IMAGE_PASTE_FILES,
} from "@/components/design/design-canvas/image-paste-files";

export interface ReportSkippedImagePasteArgs {
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runReportSkippedImagePaste(
  { t }: ReportSkippedImagePasteArgs,
  skipped: IframeImagePasteSkipped,
) {
  if (skipped.tooMany > 0) {
    toast.error(
      t("designEditor.toasts.pasteMediaTooMany", {
        count: skipped.tooMany,
        limit: MAX_IMAGE_PASTE_FILES,
      }),
    );
  }
  if (skipped.tooLarge > 0) {
    toast.error(
      t("designEditor.toasts.pasteMediaTooLarge", {
        count: skipped.tooLarge,
        limitMb: MAX_IMAGE_PASTE_FILE_MB,
      }),
    );
  }
  if (skipped.invalid > 0) toast.error(t("common.genericError"));
}
