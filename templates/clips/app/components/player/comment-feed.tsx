import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUp } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

import {
  CommentComposer as CommentTextComposer,
  type MentionEntry,
} from "./comment-composer";

export interface CommentSubmissionWidgetProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onMentionAdd: (mention: MentionEntry) => void;
  members: { email: string; name: string | null }[];
  onSubmit: () => void;
}

export function CommentSubmissionWidget({
  draft,
  onDraftChange,
  onMentionAdd,
  members,
  onSubmit,
}: CommentSubmissionWidgetProps) {
  const t = useT();

  return (
    <div className="comment-widget-shadow flex min-h-[96px] w-full flex-col items-start px-2.5 py-3">
      <div className="relative flex min-h-[72px] w-full items-start rounded-xl border border-[hsl(var(--comment-input-border))] bg-background shadow-[var(--comment-input-shadow)] transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:shadow-[var(--comment-input-shadow)]">
        <div className="flex flex-1 items-start px-4 pb-2 pt-[11px] pr-12">
          <CommentTextComposer
            value={draft}
            aria-label={t("commentsPanel.leaveComment")}
            onChange={onDraftChange}
            onMentionAdd={onMentionAdd}
            members={members}
            onSubmit={onSubmit}
            placeholder={t("commentsPanel.leaveComment")}
            rows={2}
            className="h-auto min-h-[54px] w-full resize-none border-0 bg-transparent p-0 text-sm leading-5 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
            submitOnEnter
          />
        </div>
        <Button
          type="button"
          aria-label={t("commentsPanel.commentButton")}
          data-comment-submit
          onClick={onSubmit}
          disabled={!draft.trim()}
          size="icon"
          className="absolute bottom-2 right-[7px] size-[22px] rounded-full bg-primary p-[5px] text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        >
          <IconArrowUp className="size-3" />
        </Button>
      </div>
    </div>
  );
}
