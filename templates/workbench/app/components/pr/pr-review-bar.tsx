import { useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconLoader2,
  IconMessage,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Sticky bottom review bar on `/prs/:owner/:repo/:n`. Three action modes
 * (Comment / Approve / Request changes), a textarea for the body, and a
 * template picker that expands a saved snippet into the body.
 *
 * Submission is owned by the parent — this component just calls
 * `onSubmit(action, message)`. The parent fires the right action
 * (`approve-pr` / `request-changes-pr` / `comment-pr`) and shows a toast.
 *
 * Permissions: when `permissions.canApprove` is false (e.g. viewer is the
 * PR author) the Approve mode is hidden behind a tooltip explaining why.
 */
export type PRReviewAction = "comment" | "approve" | "request-changes";

export interface PRReviewTemplate {
  id: string;
  label: string;
  body: string;
}

interface PRReviewBarProps {
  permissions: {
    canApprove: boolean;
    canRequestChanges: boolean;
    canComment: boolean;
    isAuthor: boolean;
  };
  templates: PRReviewTemplate[];
  onSubmit: (action: PRReviewAction, message: string) => Promise<void> | void;
  submitting?: boolean;
}

const ACTIONS: {
  value: PRReviewAction;
  label: string;
  icon: typeof IconCheck;
}[] = [
  { value: "comment", label: "Comment", icon: IconMessage },
  { value: "approve", label: "Approve", icon: IconCheck },
  { value: "request-changes", label: "Request changes", icon: IconX },
];

export function PRReviewBar({
  permissions,
  templates,
  onSubmit,
  submitting,
}: PRReviewBarProps) {
  const [action, setAction] = useState<PRReviewAction>(
    permissions.canApprove ? "approve" : "comment",
  );
  const [message, setMessage] = useState("");

  const messageRequired = action === "request-changes" || action === "comment";
  const canSubmit =
    !submitting &&
    (action === "approve" ? true : message.trim().length > 0) &&
    (action === "comment" ? permissions.canComment : true) &&
    (action === "approve" ? permissions.canApprove : true) &&
    (action === "request-changes" ? permissions.canRequestChanges : true);

  async function handleSubmit() {
    if (!canSubmit) return;
    await onSubmit(action, message);
    setMessage("");
  }

  return (
    <div className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <ActionModeRow
          action={action}
          onChange={setAction}
          permissions={permissions}
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="pr-review-message">
              Review message
            </label>
            <textarea
              id="pr-review-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (canSubmit) void handleSubmit();
                }
              }}
              placeholder={
                action === "approve"
                  ? "Optional message…"
                  : action === "request-changes"
                    ? "What needs to change?"
                    : "Leave a comment…"
              }
              rows={2}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            />
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            {templates.length > 0 ? (
              <TemplatesMenu
                templates={templates}
                onPick={(body) =>
                  setMessage((current) =>
                    current.trim().length > 0 ? `${current}\n${body}` : body,
                  )
                }
              />
            ) : null}
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                "cursor-pointer",
                !canSubmit && "cursor-not-allowed",
              )}
            >
              {submitting ? (
                <IconLoader2 size={14} className="animate-spin" aria-hidden />
              ) : null}
              Submit review
            </Button>
          </div>
        </div>
        {messageRequired && message.trim().length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {action === "request-changes"
              ? "A message is required when requesting changes."
              : "Add a comment or pick a template to enable submit."}{" "}
            <span className="opacity-60">⌘/Ctrl + Enter submits.</span>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground opacity-60">
            ⌘/Ctrl + Enter to submit
          </p>
        )}
        {permissions.isAuthor && action === "approve" ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            You can't approve your own PR. Switch to Comment to leave feedback.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ActionModeRow({
  action,
  onChange,
  permissions,
}: {
  action: PRReviewAction;
  onChange: (next: PRReviewAction) => void;
  permissions: PRReviewBarProps["permissions"];
}) {
  return (
    <div className="flex items-center gap-1.5">
      {ACTIONS.map(({ value, label, icon: Icon }) => {
        const disabled =
          (value === "approve" && !permissions.canApprove) ||
          (value === "request-changes" && !permissions.canRequestChanges) ||
          (value === "comment" && !permissions.canComment);
        const active = action === value;
        const button = (
          <button
            type="button"
            onClick={() => !disabled && onChange(value)}
            disabled={disabled}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-input bg-background text-foreground hover:bg-accent",
              disabled && "cursor-not-allowed opacity-50",
              !disabled && "cursor-pointer",
            )}
          >
            <Icon size={12} aria-hidden />
            {label}
          </button>
        );
        if (disabled && value === "approve" && permissions.isAuthor) {
          return (
            <Tooltip key={value}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>
                Authors can't approve their own PR.
              </TooltipContent>
            </Tooltip>
          );
        }
        return <span key={value}>{button}</span>;
      })}
    </div>
  );
}

function TemplatesMenu({
  templates,
  onPick,
}: {
  templates: PRReviewTemplate[];
  onPick: (body: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer">
          Template
          <IconChevronDown size={12} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-xs">
        {templates.map((template) => (
          <DropdownMenuItem
            key={template.id}
            onSelect={() => onPick(template.body)}
            className="cursor-pointer flex-col items-start gap-0.5"
          >
            <span className="text-xs font-medium">{template.label}</span>
            <span className="line-clamp-2 text-[10px] text-muted-foreground">
              {template.body}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
