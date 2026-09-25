import { useT } from "@agent-native/core/client/i18n";
import { IconThumbDown, IconThumbUp } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function ImportanceFeedbackMenu({
  onFeedback,
  className,
}: {
  onFeedback: (decision: "important" | "not-important") => void;
  className?: string;
}) {
  const t = useT();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("mail.sort.priorityFeedbackLabel")}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            className,
          )}
        >
          <span aria-hidden className="relative block size-4">
            <IconThumbUp className="absolute left-0 top-0 size-3" />
            <IconThumbDown className="absolute bottom-0 right-0 size-3" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onFeedback("important")}>
          <IconThumbUp className="size-3.5" />
          {t("mail.aiFilter.importantMode")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onFeedback("not-important")}>
          <IconThumbDown className="size-3.5" />
          {t("mail.aiFilter.notImportantMode")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
