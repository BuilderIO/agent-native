import { emailToColor } from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT, useFormatters } from "@agent-native/core/client/i18n";
import {
  InlineMarkdown,
  type InlineMarkdownProtectedSpan,
} from "@agent-native/core/client/markdown";
import { IconDots } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  Avatar as UserAvatar,
  AvatarFallback as UserAvatarFallback,
  AvatarImage as UserAvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateComment,
  useEditComment,
  type Comment,
  type CommentMention,
} from "@/hooks/use-comments";
import type { MentionMember } from "@/hooks/use-mention-members";

import { useCommentDraft } from "./comment-drafts";
import { CommentComposer, type MentionEntry } from "./CommentComposer";

/**
 * Render a comment body, styling any `@mention` tokens that match the comment's
 * stored mentions. Raw HTML is never interpreted.
 */
function commentMentionSpans(
  mentions: CommentMention[],
): InlineMarkdownProtectedSpan[] {
  const labels = Array.from(
    new Set(mentions.map((m) => m.name).filter((n): n is string => !!n)),
  ).sort((a, b) => b.length - a.length);
  return labels.map((label) => ({
    source: `@${label}`,
    label: `@${label}`,
    className: "comment-mention",
  }));
}

function renderCommentBody(content: string, mentions: CommentMention[]) {
  return (
    <InlineMarkdown
      content={content}
      inline
      protectedSpans={commentMentionSpans(mentions)}
    />
  );
}

/** Mentions whose label still appears in the text, serialized for storage. */
function mentionsJsonFor(
  text: string,
  mentions: MentionEntry[],
): string | undefined {
  const present = mentions.filter((m) => text.includes(`@${m.name}`));
  const seen = new Set<string>();
  const deduped = present.filter((m) =>
    seen.has(m.email) ? false : (seen.add(m.email), true),
  );
  return deduped.length ? JSON.stringify(deduped) : undefined;
}

function emailToInitial(email: string) {
  return (email.split("@")[0]?.[0] ?? "?").toUpperCase();
}

function CommentAvatar({
  email,
  name,
  className = "h-6 w-6",
}: {
  email?: string | null;
  name?: string | null;
  className?: string;
}) {
  const avatarUrl = useAvatarUrl(email);
  const label = name ?? email ?? "";
  return (
    <UserAvatar className={className} title={label}>
      {avatarUrl ? <UserAvatarImage src={avatarUrl} alt={label} /> : null}
      <UserAvatarFallback
        className="text-[11px] font-medium text-primary-foreground"
        style={{ backgroundColor: emailToColor(email ?? "user") }}
      >
        {emailToInitial(label)}
      </UserAvatarFallback>
    </UserAvatar>
  );
}

export function getAiCommentSource(
  submissionSource: string | null | undefined,
): "mcp" | "agent" | null {
  return submissionSource === "mcp" || submissionSource === "agent"
    ? submissionSource
    : null;
}

export function CommentAttributionBadge({ comment }: { comment: Comment }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const source = getAiCommentSource(comment.submission_source);
  if (!source) return null;

  const authorName =
    comment.author_name ??
    comment.author_email.split("@")[0] ??
    comment.author_email;
  const attribution = t("comments.aiAttribution", { name: authorName });
  const sourceLabel = t(
    source === "mcp" ? "comments.aiSourceMcp" : "comments.aiSourceAgent",
  );

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${attribution}. ${sourceLabel}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          className="pointer-events-auto -m-1 inline-flex shrink-0 items-center justify-center rounded p-1 leading-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-comment-ai-attribution={source}
        >
          <span className="inline-flex h-4 min-w-5 items-center justify-center rounded border border-border bg-muted/50 px-1 text-[10px] font-semibold leading-none tracking-wide">
            {t("comments.aiBadge")}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-max max-w-60 px-2 py-1.5 text-xs leading-4"
      >
        <span className="grid gap-0.5">
          <span>{attribution}</span>
          <span className="text-muted-foreground">{sourceLabel}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function CommentEntry({
  comment,
  documentId,
  currentUserEmail,
  canComment,
  members,
}: {
  comment: Comment;
  documentId: string;
  currentUserEmail?: string;
  canComment: boolean;
  members: MentionMember[];
}) {
  const t = useT();
  const { formatDate } = useFormatters();
  const edit = useEditComment();
  const create = useCreateComment({ email: currentUserEmail });
  const [checking, setChecking] = useState(false);
  const sourceDraft = useCommentDraft(
    comment.parent_id ? `reply:${documentId}:${comment.thread_id}` : "pending",
  );
  const [editing, setEditing] = useState(false);
  const initialDraft = { text: comment.content, mentions: comment.mentions };
  const draft = useCommentDraft(`edit:${comment.id}`, initialDraft);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const pending = comment.mutation?.status === "pending";
  const showMutationStatus =
    comment.mutation?.kind !== "resolve" || !comment.parent_id;
  const canEdit =
    canComment &&
    !!currentUserEmail &&
    currentUserEmail.toLowerCase() === comment.author_email.toLowerCase() &&
    !pending &&
    comment.mutation?.kind !== "create";
  const checkSaved = async () => {
    if (!comment.mutation?.ambiguous || checking) return;
    const submitted = sourceDraft.getSubmittedDraft(
      comment.mutation.operationId,
    );
    setChecking(true);
    try {
      const result = await create.reconcileAmbiguous(
        documentId,
        comment.mutation.operationId,
      );
      if (result === "confirmed" && submitted) {
        sourceDraft.clearIfUnchanged(submitted);
      }
    } catch (error) {
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setChecking(false);
    }
  };
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => menuRef.current?.focus());
  };
  const save = async () => {
    if (!draft.draft.text.trim() || edit.isPending) return;
    const submitted = draft.draft;
    try {
      await draft.clearOnSuccess(
        submitted,
        edit.mutateAsync(
          {
            id: comment.id,
            documentId,
            content: submitted.text.trim(),
            mentions:
              mentionsJsonFor(submitted.text, submitted.mentions) ?? "[]",
          },
          {
            onSuccess: close,
            onError: () => inputRef.current?.focus(),
          },
        ),
      );
    } catch (error) {
      toast.error(t("empty.genericError"), {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
  return (
    <div
      className="group/comment mb-3 last:mb-0"
      data-comment-id={comment.id}
      onClick={(event) => {
        if (
          editing ||
          (event.target as HTMLElement).closest(
            "button, textarea, [role=menuitem]",
          )
        )
          event.stopPropagation();
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <CommentAvatar
          email={comment.author_email}
          name={comment.author_name ?? comment.author_email}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {comment.author_name ?? comment.author_email.split("@")[0]}
        </span>
        <CommentAttributionBadge comment={comment} />
        <span className="text-xs text-muted-foreground">
          {formatDate(comment.created_at, { month: "short", day: "numeric" })}
        </span>
        {canEdit && !editing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuRef}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("comments.commentActions")}
                className="size-7"
              >
                <IconDots size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" data-comment-menu>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  {t("comments.edit")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="text-[13px] text-foreground/90 pl-8 leading-relaxed">
        {editing ? (
          <div>
            <CommentComposer
              ref={inputRef}
              ariaLabel={t("comments.edit")}
              value={draft.draft.text}
              onChange={draft.setText}
              members={members}
              onMentionAdd={(mention) =>
                draft.setMentions((previous) => [...previous, mention])
              }
              onSubmit={save}
              onEscape={close}
              autoFocus
              disabled={edit.isPending}
            />
            <div className="mt-1 flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={edit.isPending}
                onClick={() => {
                  draft.discard();
                  close();
                }}
              >
                {t("comments.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={edit.isPending || !draft.draft.text.trim()}
                onClick={save}
              >
                {t("comments.save")}
              </Button>
            </div>
          </div>
        ) : (
          renderCommentBody(comment.content, comment.mentions)
        )}
        {pending && showMutationStatus && (
          <span role="status" className="block text-xs text-muted-foreground">
            {t("comments.saving")}
          </span>
        )}
        {comment.mutation?.ambiguous && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={checking}
            onClick={checkSaved}
          >
            {t("comments.checkSaved")}
          </Button>
        )}
        {comment.mutation?.status === "error" && showMutationStatus && (
          <span role="alert" className="block text-xs text-destructive">
            {t(
              comment.mutation.ambiguous
                ? "comments.saveUnconfirmed"
                : "empty.genericError",
            )}
          </span>
        )}
      </div>
    </div>
  );
}
