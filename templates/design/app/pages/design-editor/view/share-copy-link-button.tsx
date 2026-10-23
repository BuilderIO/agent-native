import { IconCheck, IconLink } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { EditorCore } from "../domains/use-editor-core";

const COPIED_FEEDBACK_MS = 1500;

export function ShareCopyLinkButton({
  editorCore,
  shareUrl,
  className,
}: {
  editorCore: EditorCore;
  shareUrl: string | undefined;
  className?: string;
}) {
  const { t } = editorCore;
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copyLink = () => {
    if (!shareUrl || !navigator.clipboard) {
      toast.error(t("review.copyLinkFailed"));
      return;
    }
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        if (resetTimerRef.current !== null) {
          window.clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = window.setTimeout(
          () => setCopied(false),
          COPIED_FEEDBACK_MS,
        );
      })
      .catch(() => toast.error(t("review.copyLinkFailed")));
  };

  const label = copied ? t("review.linkCopied") : t("review.copyLink");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          aria-label={label}
          disabled={!shareUrl}
          className={cn("w-7 min-w-0 px-0", className)}
          onClick={copyLink}
        >
          {copied ? (
            <IconCheck className="size-3.5" />
          ) : (
            <IconLink className="size-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
