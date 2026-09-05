import { useT } from "@agent-native/core/client/i18n";
import { IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export interface GenerationStatusCardProps {
  generating: boolean;
  /** Non-null only when generation failed; the caller gates on it. */
  issue: string | null;
  retryablePrompt: string | null;
  onRetry: () => void;
}

/**
 * Shown in the canvas column only while a design with nothing in it is
 * generating or has just failed. An empty design is not a state worth
 * announcing — it renders the board and the tools instead — but a failure
 * with no retry leaves the run unrecoverable, so that half stays.
 */
export function GenerationStatusCard({
  generating,
  issue,
  retryablePrompt,
  onRetry,
}: GenerationStatusCardProps) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        {generating ? (
          <>
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-[var(--design-editor-panel-divider-color)] bg-[var(--design-editor-panel-bg)] shadow-[0_18px_50px_-34px_rgba(0,0,0,0.8)]">
              <Spinner className="size-5 text-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("designEditor.generating")}
            </p>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm font-medium text-foreground/85">
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
                className="h-8 cursor-pointer rounded-md"
                onClick={onRetry}
              >
                <IconRefresh className="h-3.5 w-3.5" />
                {t("designEditor.tryAgain")}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
