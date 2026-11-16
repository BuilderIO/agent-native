import { useT } from "@agent-native/core/client/i18n";
import { IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export interface GenerationStatusCardProps {
  issue: string | null;
  retryablePrompt: string | null;
  onRetry: () => void;
}

export function GenerationStatusCard({
  issue,
  retryablePrompt,
  onRetry,
}: GenerationStatusCardProps) {
  const t = useT();
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
