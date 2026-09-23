import { useT } from "@agent-native/core/client/i18n";
import type { TiptapComposerHandle } from "@agent-native/toolkit/composer";
import { IconDots, IconExternalLink } from "@tabler/icons-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCreateComment,
  useEditComment,
  useReactToComment,
  type Comment,
} from "@/hooks/use-comments";
import type { MentionMember } from "@/hooks/use-mention-members";

import {
  AgentAvatar,
  agentDisplayName,
  modelDisplayName,
} from "./agent-identity";
import { useCommentDraft } from "./comment-drafts";
import { CommentComposer, type MentionEntry } from "./CommentComposer";
import { AddReactionButton, CommentReactionChips } from "./CommentReactions";
import {
  CommentAgentBadge,
  CommentAvatar,
  CommentIconButton,
  CommentRow,
  renderCommentBody,
  useCommentTimestamp,
} from "./CommentRow";

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

export function getAiCommentSource(
  submissionSource: string | null | undefined,
): "mcp" | "agent" | null {
  return submissionSource === "mcp" || submissionSource === "agent"
    ? submissionSource
    : null;
}

/**
 * "Agent" pill for comments posted through MCP or the in-app agent. The
 * comment's author is still the accountable person; the tooltip says so.
 */
export function CommentAttributionBadge({ comment }: { comment: Comment }) {
  const t = useT();
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
  const modelLabel = comment.author_model
    ? modelDisplayName(comment.author_model)
    : null;

  return (
    <span data-comment-ai-attribution={source} className="contents">
      <CommentAgentBadge
        ariaLabel={`${attribution}. ${sourceLabel}${modelLabel ? `. ${modelLabel}` : ""}`}
        details={
          <span className="grid gap-0.5">
            {modelLabel ? (
              <span className="font-medium">{modelLabel}</span>
            ) : null}
            <span>{attribution}</span>
            <span className="text-muted-foreground">{sourceLabel}</span>
          </span>
        }
      />
    </span>
  );
}

export function CommentEntry({
  comment,
  documentId,
  currentUserEmail,
  canComment,
  members,
  headerActions,
  revealActions = "always",
  replyAction,
  footer,
  onOpenAiConversation,
}: {
  comment: Comment;
  documentId: string;
  currentUserEmail?: string;
  canComment: boolean;
  members: MentionMember[];
  /** Thread-level actions (resolve, accept) shown after this row's menu. */
  headerActions?: ReactNode;
  revealActions?: "always" | "hover";
  /**
   * The panel feed's inline "Reply" action. When set, Reply and the reaction
   * picker sit in one row under the comment instead of in the header.
   */
  replyAction?: ReactNode;
  footer?: ReactNode;
  onOpenAiConversation?: () => void;
}) {
  const t = useT();
  const timestamp = useCommentTimestamp();
  const edit = useEditComment();
  const react = useReactToComment();
  const create = useCreateComment({ email: currentUserEmail });
  const [checking, setChecking] = useState(false);
  const sourceDraft = useCommentDraft(
    comment.parent_id ? `reply:${documentId}:${comment.thread_id}` : "pending",
  );
  const [editing, setEditing] = useState(false);
  const initialDraft = {
    text: comment.content,
    mentions: comment.mentions,
    aiDraft: null,
  };
  const draft = useCommentDraft(`edit:${comment.id}`, initialDraft);
  const inputRef = useRef<TiptapComposerHandle>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const pending = comment.mutation?.status === "pending";
  const showMutationStatus =
    comment.mutation?.kind !== "resolve" || !comment.parent_id;
  const aiSource = getAiCommentSource(comment.submission_source);
  const aiAuthored = Boolean(aiSource && comment.author_model);
  const visibleAuthor = aiAuthored
    ? agentDisplayName(comment.author_model)
    : (comment.author_name ?? comment.author_email.split("@")[0]);
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
  const reactions = comment.reactions ?? [];
  const canReact =
    canComment && !pending && comment.mutation?.kind !== "create";
  const toggleReaction = (reaction: string, active: boolean) =>
    react.mutate(
      { documentId, commentId: comment.id, reaction, active },
      {
        onError: (error) =>
          toast.error(t("empty.genericError"), {
            description: error instanceof Error ? error.message : undefined,
          }),
      },
    );
  const feedLayout = replyAction !== undefined && revealActions === "always";
  const hoverOnly =
    "opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";
  const addReaction =
    canReact && !editing ? (
      <AddReactionButton
        className={
          feedLayout || revealActions === "hover" ? undefined : hoverOnly
        }
        onSelect={(reaction) =>
          toggleReaction(
            reaction,
            !reactions.find((entry) => entry.reaction === reaction)
              ?.reactedByMe,
          )
        }
      />
    ) : null;
  const menu =
    (canEdit || onOpenAiConversation) && !editing ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <CommentIconButton
            ref={menuRef}
            aria-label={t("comments.commentActions")}
          >
            <IconDots size={18} />
          </CommentIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-comment-menu>
          <DropdownMenuGroup>
            {canEdit ? (
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                {t("comments.edit")}
              </DropdownMenuItem>
            ) : null}
            {onOpenAiConversation ? (
              <DropdownMenuItem onSelect={onOpenAiConversation}>
                <IconExternalLink size={14} />
                {t("comments.aiOpenConversation")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;
  const time = timestamp(comment.created_at);
  const saveStatus = (
    <>
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
    </>
  );
  const hasSaveStatus =
    (pending && showMutationStatus) ||
    comment.mutation?.ambiguous ||
    (comment.mutation?.status === "error" && showMutationStatus);

  return (
    <CommentRow
      data-comment-id={comment.id}
      onClick={(event) => {
        if (
          editing ||
          (event.target as HTMLElement).closest(
            "button, textarea, [contenteditable=true], [role=menuitem]",
          )
        )
          event.stopPropagation();
      }}
      avatar={
        aiAuthored ? (
          <AgentAvatar model={comment.author_model} />
        ) : (
          <CommentAvatar
            email={comment.author_email}
            name={comment.author_name ?? comment.author_email}
          />
        )
      }
      name={visibleAuthor}
      badge={<CommentAttributionBadge comment={comment} />}
      timestamp={{ ...time, dateTime: comment.created_at }}
      actions={
        (!feedLayout && addReaction) || menu || headerActions ? (
          <>
            {feedLayout ? null : addReaction}
            {menu}
            {headerActions}
          </>
        ) : null
      }
      revealActions={revealActions}
      footer={
        hasSaveStatus || footer || reactions.length || feedLayout ? (
          <div className="grid gap-1.5">
            {saveStatus}
            {feedLayout ? (
              <div
                className="flex flex-wrap items-center gap-1"
                data-comment-action-row
              >
                {replyAction}
                {addReaction}
                <CommentReactionChips
                  reactions={reactions}
                  canReact={canReact}
                  onToggle={toggleReaction}
                />
              </div>
            ) : (
              <CommentReactionChips
                reactions={reactions}
                canReact={canReact}
                onToggle={toggleReaction}
              />
            )}
            {footer}
          </div>
        ) : null
      }
    >
      {editing ? (
        <div className="mt-1">
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
            submitLabel={t("comments.save")}
            onCancel={() => {
              draft.discard();
              close();
            }}
          />
        </div>
      ) : (
        renderCommentBody(comment.content, comment.mentions)
      )}
    </CommentRow>
  );
}
