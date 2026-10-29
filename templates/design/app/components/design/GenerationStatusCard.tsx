import { useT } from "@agent-native/core/client/i18n";
import { IconRefresh } from "@tabler/icons-react";

import { GeneratingDesignPreview } from "@/components/design/GeneratingDesignPreview";
import { Button } from "@/components/ui/button";
import { useGeneratingDesignPreview } from "@/hooks/use-generating-design-preview";

export interface GenerationStatusCardProps {
  designId: string;
  generating: boolean;
  /**
   * The first screen as saved so far. A skeleton-first build lands its
   * sections as edits; the preview follows the saved screen between calls.
   */
  savedHtml?: string | undefined;
  /** The run ended; the preview stays while the last frames finish drawing. */
  settling?: boolean | undefined;
  issue: string | null;
  retryablePrompt: string | null;
  onRetry: () => void;
}

export function GenerationStatusCard({
  designId,
  generating,
  savedHtml,
  settling = false,
  issue,
  retryablePrompt,
  onRetry,
}: GenerationStatusCardProps) {
  const t = useT();
  const preview = useGeneratingDesignPreview({ designId, generating });
  if (generating) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
        <GeneratingDesignPreview
          preview={preview}
          savedHtml={savedHtml}
          settling={settling}
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <p role="alert" className="mb-3 text-sm font-medium text-destructive">
          {issue}
        </p>
        {retryablePrompt ? (
          <p className="mx-auto mb-4 max-w-sm text-xs italic text-muted-foreground/70">
            {`"${retryablePrompt}"`}
          </p>
        ) : null}
        {retryablePrompt ? (
          <Button
            size="sm"
            className="cursor-pointer rounded-md"
            onClick={onRetry}
          >
            <IconRefresh className="h-3.5 w-3.5" />
            {t("designEditor.tryAgain")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
