import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { cn } from "@agent-native/toolkit/utils";
import { IconAlertCircle, IconCheck, IconDots } from "@tabler/icons-react";
import { Fragment, useRef } from "react";

export interface ReviewThreadMenuProps {
  /** Each agent item renders only when its handler is passed. */
  onSendToAgent?: (() => void) | undefined;
  onSuggestChanges?: (() => void) | undefined;
  onReplyInThread?: (() => void) | undefined;
  onApplyAndResolve?: (() => void) | undefined;
  /** Disables the agent items while one of them is still being handed off. */
  agentActionsDisabled?: boolean | undefined;
  /** Shows the Edit item (also needs `onEdit`). */
  canEdit?: boolean | undefined;
  onEdit?: (() => void) | undefined;
  /** Shows the read/unread toggle. */
  onToggleUnread?: (() => void) | undefined;
  /** The thread is unread now, so the toggle reads "Mark as read". */
  unread?: boolean | undefined;
  onCopyLink?: (() => void) | undefined;
  copyLinkState?: "idle" | "copied" | "failed" | undefined;
  copyLinkDisabled?: boolean | undefined;
  onDelete?: (() => void) | undefined;
  moreActionsLabel?: string | undefined;
  sendToAgentLabel?: string | undefined;
  suggestChangesLabel?: string | undefined;
  replyInThreadLabel?: string | undefined;
  applyAndResolveLabel?: string | undefined;
  editLabel?: string | undefined;
  markUnreadLabel?: string | undefined;
  markReadLabel?: string | undefined;
  copyLinkLabel?: string | undefined;
  linkCopiedLabel?: string | undefined;
  copyLinkFailedLabel?: string | undefined;
  deleteLabel?: string | undefined;
  align?: "start" | "center" | "end" | undefined;
  /** Class names for the 28px trigger button. */
  className?: string | undefined;
}

const ITEM_CLASS = "h-7 whitespace-nowrap px-2 py-1 text-sm";

export function ReviewThreadMenu({
  onSendToAgent,
  onSuggestChanges,
  onReplyInThread,
  onApplyAndResolve,
  agentActionsDisabled = false,
  canEdit = false,
  onEdit,
  onToggleUnread,
  unread = false,
  onCopyLink,
  copyLinkState = "idle",
  copyLinkDisabled = false,
  onDelete,
  moreActionsLabel = "More actions",
  sendToAgentLabel = "Send to agent",
  suggestChangesLabel = "Suggest changes",
  replyInThreadLabel = "Reply in thread",
  applyAndResolveLabel = "Apply changes and resolve",
  editLabel = "Edit",
  markUnreadLabel = "Mark as unread",
  markReadLabel = "Mark as read",
  copyLinkLabel = "Copy link",
  linkCopiedLabel = "Link copied",
  copyLinkFailedLabel = "Couldn’t copy link",
  deleteLabel = "Delete thread",
  align = "end",
  className,
}: ReviewThreadMenuProps) {
  const editChosenRef = useRef(false);
  const agentItem = (
    key: string,
    label: string,
    onSelect: (() => void) | undefined,
  ) =>
    onSelect ? (
      <DropdownMenuItem
        key={key}
        className={ITEM_CLASS}
        disabled={agentActionsDisabled}
        onSelect={onSelect}
      >
        {label}
      </DropdownMenuItem>
    ) : null;
  const groups = [
    [
      agentItem("send", sendToAgentLabel, onSendToAgent),
      agentItem("suggest", suggestChangesLabel, onSuggestChanges),
      agentItem("reply", replyInThreadLabel, onReplyInThread),
    ],
    [agentItem("apply", applyAndResolveLabel, onApplyAndResolve)],
    [
      canEdit && onEdit ? (
        <DropdownMenuItem
          key="edit"
          className={ITEM_CLASS}
          onSelect={() => {
            editChosenRef.current = true;
            onEdit();
          }}
        >
          {editLabel}
        </DropdownMenuItem>
      ) : null,
      onToggleUnread ? (
        <DropdownMenuItem
          key="unread"
          className={ITEM_CLASS}
          onSelect={onToggleUnread}
        >
          {unread ? markReadLabel : markUnreadLabel}
        </DropdownMenuItem>
      ) : null,
    ],
    [
      onCopyLink ? (
        <DropdownMenuItem
          key="copy"
          className={ITEM_CLASS}
          disabled={copyLinkDisabled}
          onSelect={onCopyLink}
        >
          {copyLinkState === "copied" ? (
            <IconCheck className="size-4" />
          ) : copyLinkState === "failed" ? (
            <IconAlertCircle className="size-4" />
          ) : null}
          {copyLinkState === "copied"
            ? linkCopiedLabel
            : copyLinkState === "failed"
              ? copyLinkFailedLabel
              : copyLinkLabel}
        </DropdownMenuItem>
      ) : null,
      onDelete ? (
        <DropdownMenuItem
          key="delete"
          className={cn(ITEM_CLASS, "text-destructive focus:text-destructive")}
          onSelect={onDelete}
        >
          {deleteLabel}
        </DropdownMenuItem>
      ) : null,
    ],
  ]
    .map((items) => items.filter(Boolean))
    .filter((items) => items.length > 0);
  if (groups.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 shrink-0 rounded-[8px] text-muted-foreground hover:text-foreground",
            className,
          )}
          aria-label={moreActionsLabel}
        >
          <IconDots className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-review-popover=""
        align={align}
        className="w-max min-w-[200px] p-1"
        onCloseAutoFocus={(event) => {
          // Edit puts focus in its composer; leave it there. Other actions
          // return to the button.
          if (editChosenRef.current) event.preventDefault();
          editChosenRef.current = false;
        }}
      >
        {groups.map((items, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <DropdownMenuSeparator className="-mx-1 my-1" />
            ) : null}
            {items}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
