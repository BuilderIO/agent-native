import { IconFileStack, IconChevronDown } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorModes } from "../domains/use-editor-modes";

export function renderPendingNodeRewriteButton({
  editorCore,
  editorFilesAndSaving,
  editorModes,
  compact,
}: {
  editorCore: EditorCore;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorModes: EditorModes;
  compact: boolean;
}) {
  const { t } = editorCore;
  const { pendingNodeRewriteProposals } = editorFilesAndSaving;
  const { handleReviewNodeRewrite } = editorModes;

  const pendingNodeRewriteLabel = t("designEditor.nodeRewrite.pendingReview", {
    count: pendingNodeRewriteProposals.length,
  });

  const pendingNodeRewriteButtonContent = (
    <>
      {!compact ? (
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      ) : null}
      <IconFileStack className="size-3.5 shrink-0" />
      {compact ? (
        <span className="min-w-4 rounded bg-primary/10 px-1 text-center text-[10px] font-semibold tabular-nums text-primary">
          {pendingNodeRewriteProposals.length}
        </span>
      ) : (
        <span className="truncate">{pendingNodeRewriteLabel}</span>
      )}
    </>
  );
  const pendingNodeRewriteButtonClassName = cn(
    "h-8 rounded-md border-primary/30 bg-primary/5 text-xs hover:bg-primary/10",
    compact ? "min-w-10 gap-1 px-1.5" : "max-w-44 gap-1.5 px-2",
  );
  return pendingNodeRewriteProposals.length ===
    0 ? null : pendingNodeRewriteProposals.length === 1 ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={pendingNodeRewriteButtonClassName}
          aria-label={pendingNodeRewriteLabel}
          onClick={() =>
            handleReviewNodeRewrite(pendingNodeRewriteProposals[0]!)
          }
        >
          {pendingNodeRewriteButtonContent}
        </Button>
      </TooltipTrigger>
      {compact ? (
        <TooltipContent>{pendingNodeRewriteLabel}</TooltipContent>
      ) : null}
    </Tooltip>
  ) : (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={pendingNodeRewriteButtonClassName}
              aria-label={pendingNodeRewriteLabel}
            >
              {pendingNodeRewriteButtonContent}
              {!compact ? (
                <IconChevronDown className="size-3 shrink-0 opacity-70" />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {compact ? (
          <TooltipContent>{pendingNodeRewriteLabel}</TooltipContent>
        ) : null}
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("designEditor.nodeRewrite.pendingReviewMenu")}
        </DropdownMenuLabel>
        {pendingNodeRewriteProposals.map((proposal) => (
          <DropdownMenuItem
            key={proposal.proposalId}
            onClick={() => handleReviewNodeRewrite(proposal)}
          >
            <IconFileStack className="size-4" />
            <span className="min-w-0 flex-1 truncate">
              {prettyScreenName(proposal.filename)}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {proposal.variants.length}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
