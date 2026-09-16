import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconAt,
  IconFocus2,
  IconMessageCircle,
  IconMoodSmile,
  IconSend,
} from "@tabler/icons-react";
import {
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import type {
  ReviewMention,
  ReviewResolutionTarget,
} from "../../review/types.js";
import { cn } from "../utils.js";

const DEFAULT_COMPOSER_EMOJIS = ["👍", "❤️", "🎉", "👀"] as const;

export interface ReviewCommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (resolutionTarget: ReviewResolutionTarget) => void;
  mentions?: readonly ReviewMention[];
  onMentionsChange?: (mentions: ReviewMention[]) => void;
  mentionOptions?: readonly ReviewMention[];
  showCommentTools?: boolean;
  commentToolsEnd?: ReactNode;
  emojiChoices?: readonly string[];
  emojiLabel?: string;
  mentionLabel?: string;
  noMentionsLabel?: string;
  submittingTarget?: ReviewResolutionTarget | null;
  disabled?: boolean;
  showCommentAction?: boolean;
  showAgentAction?: boolean;
  agentAction?: ReactNode;
  placeholder?: string;
  commentLabel?: string;
  agentLabel?: string;
  contextLabel?: string;
  autoFocus?: boolean;
  submitOnEnter?: boolean;
  enterSubmitTarget?: ReviewResolutionTarget;
  onEscape?: () => void;
  textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement> &
    Record<string, unknown>;
  className?: string;
}

export function ReviewCommentComposer({
  value,
  onChange,
  onSubmit,
  mentions = [],
  onMentionsChange,
  mentionOptions = [],
  showCommentTools = false,
  commentToolsEnd,
  emojiChoices = DEFAULT_COMPOSER_EMOJIS,
  emojiLabel = "Add emoji",
  mentionLabel = "Mention someone",
  noMentionsLabel = "No people found",
  submittingTarget = null,
  disabled = false,
  showCommentAction = true,
  showAgentAction = false,
  agentAction,
  placeholder = "Add a comment...",
  commentLabel = "Comment",
  agentLabel = "Send to agent",
  contextLabel,
  autoFocus = false,
  submitOnEnter = false,
  enterSubmitTarget = "human",
  onEscape,
  textareaProps,
  className,
}: ReviewCommentComposerProps) {
  const canSubmit = Boolean(value.trim()) && !disabled;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState<number | null>(
    null,
  );
  const mentionTokenEndRef = useRef<number | null>(null);
  const resetMention = () => {
    setMentionSearch("");
    setMentionTriggerIndex(null);
    mentionTokenEndRef.current = null;
    setMentionMenuOpen(false);
  };
  const filteredMentionOptions = mentionOptions.filter((mention) => {
    const query = mentionSearch.trim().toLowerCase();
    return (
      !query ||
      mention.label.toLowerCase().includes(query) ||
      mention.email?.toLowerCase().includes(query)
    );
  });
  const updateValue = (nextValue: string) => {
    onChange(nextValue);
    onMentionsChange?.(
      mentions.filter((mention) => nextValue.includes(`@${mention.label}`)),
    );
  };
  const appendText = (text: string) => {
    const start = textareaRef.current?.selectionStart ?? value.length;
    const end = textareaRef.current?.selectionEnd ?? start;
    const before = value.slice(0, start);
    const separator = before && !/\s$/.test(before) ? " " : "";
    updateValue(`${before}${separator}${text}${value.slice(end)}`);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const nextCaret = start + separator.length + text.length;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };
  const insertMention = (mention: ReviewMention) => {
    const mentionText = `@${mention.label}`;
    let nextValue: string;
    if (mentionTriggerIndex === null) {
      const start = textareaRef.current?.selectionStart ?? value.length;
      const end = textareaRef.current?.selectionEnd ?? start;
      const before = value.slice(0, start);
      const separator = before && !/\s$/.test(before) ? " " : "";
      nextValue = `${before}${separator}${mentionText}${value.slice(end)}`;
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const nextCaret = start + separator.length + mentionText.length;
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    } else {
      const naturalTokenEnd = (() => {
        const whitespaceIndex = value
          .slice(mentionTriggerIndex + 1)
          .search(/\s/);
        return whitespaceIndex < 0
          ? value.length
          : mentionTriggerIndex + 1 + whitespaceIndex;
      })();
      const tokenEnd = Math.min(
        naturalTokenEnd,
        mentionTokenEndRef.current ?? naturalTokenEnd,
      );
      nextValue = `${value.slice(0, mentionTriggerIndex)}${mentionText}${value.slice(
        tokenEnd,
      )}`;
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const nextCaret = mentionTriggerIndex + mentionText.length;
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    }
    updateValue(nextValue);
    const nextMentions = mentions.filter((current) =>
      nextValue.includes(`@${current.label}`),
    );
    if (
      !nextMentions.some(
        (current) =>
          current.email === mention.email && current.label === mention.label,
      )
    ) {
      nextMentions.push(mention);
    }
    onMentionsChange?.(nextMentions);
    resetMention();
  };
  const submit = (resolutionTarget: ReviewResolutionTarget) => {
    if (!canSubmit) return;
    onSubmit(resolutionTarget);
  };
  const submitVisibleAction = (preferred: ReviewResolutionTarget) => {
    if (preferred === "human" && showCommentAction) {
      submit("human");
      return;
    }
    if (preferred === "agent" && showAgentAction) {
      submit("agent");
      return;
    }
    if (showCommentAction) submit("human");
    else if (showAgentAction) submit("agent");
  };

  return (
    <form
      className={cn("@container/review", className)}
      onSubmit={(event) => {
        event.preventDefault();
        submitVisibleAction("human");
      }}
    >
      {contextLabel ? (
        <div className="mb-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <IconFocus2 className="size-3.5 shrink-0" />
          <span className="truncate">{contextLabel}</span>
        </div>
      ) : null}
      <Textarea
        {...textareaProps}
        ref={textareaRef}
        autoFocus={autoFocus}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          updateValue(nextValue);
          if (mentionTriggerIndex !== null) {
            const tokenStart = mentionTriggerIndex + 1;
            const whitespaceIndex = nextValue.slice(tokenStart).search(/\s/);
            const tokenEnd =
              whitespaceIndex < 0
                ? nextValue.length
                : tokenStart + whitespaceIndex;
            const caret =
              event.currentTarget.selectionStart ?? nextValue.length;
            if (
              nextValue[mentionTriggerIndex] !== "@" ||
              caret < tokenStart ||
              caret > tokenEnd
            ) {
              resetMention();
              return;
            }
            mentionTokenEndRef.current = Math.max(tokenStart, caret);
            setMentionSearch(nextValue.slice(tokenStart, caret));
          }
        }}
        onSelect={(event) => {
          if (mentionTriggerIndex === null) return;
          const tokenStart = mentionTriggerIndex + 1;
          const whitespaceIndex = event.currentTarget.value
            .slice(tokenStart)
            .search(/\s/);
          const tokenEnd =
            whitespaceIndex < 0
              ? event.currentTarget.value.length
              : tokenStart + whitespaceIndex;
          const selectionStart = event.currentTarget.selectionStart ?? 0;
          const selectionEnd =
            event.currentTarget.selectionEnd ?? selectionStart;
          if (
            event.currentTarget.value[mentionTriggerIndex] !== "@" ||
            selectionStart < tokenStart ||
            selectionEnd > tokenEnd
          ) {
            resetMention();
            return;
          }
          mentionTokenEndRef.current = selectionEnd;
          setMentionSearch(
            event.currentTarget.value.slice(tokenStart, selectionEnd),
          );
        }}
        placeholder={placeholder}
        className="min-h-16 resize-none text-sm"
        onKeyDown={(event) => {
          if (event.key === "Escape" && onEscape) {
            event.stopPropagation();
            event.preventDefault();
            onEscape();
            return;
          }
          if (
            showCommentTools &&
            mentionOptions.length > 0 &&
            event.key === "@" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            const triggerIndex =
              event.currentTarget.selectionStart ?? value.length;
            setMentionTriggerIndex(triggerIndex);
            mentionTokenEndRef.current = triggerIndex + 1;
            setMentionSearch("");
            setMentionMenuOpen(true);
          }
          if (submitOnEnter && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitVisibleAction(enterSubmitTarget);
          }
        }}
      />
      {showCommentTools ||
      commentToolsEnd ||
      showCommentAction ||
      showAgentAction ? (
        <div className="mt-2 flex flex-col items-stretch justify-end gap-2 @2xs/review:flex-row @2xs/review:items-center">
          {showCommentTools || commentToolsEnd ? (
            <div
              data-review-comment-tools
              className="flex min-w-0 items-center gap-0.5 @2xs/review:me-auto"
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground"
                    disabled={disabled}
                    aria-label={emojiLabel}
                  >
                    <IconMoodSmile className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="flex w-auto gap-0.5 p-1"
                >
                  {emojiChoices.map((emoji) => (
                    <DropdownMenuItem
                      key={emoji}
                      className="size-8 justify-center p-0 text-base"
                      onSelect={() => appendText(emoji)}
                    >
                      <span aria-hidden="true">{emoji}</span>
                      <span className="sr-only">{emoji}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {mentionOptions.length > 0 ? (
                <DropdownMenu
                  open={mentionMenuOpen}
                  onOpenChange={(open) => {
                    setMentionMenuOpen(open);
                    if (!open) {
                      setMentionSearch("");
                      setMentionTriggerIndex(null);
                      mentionTokenEndRef.current = null;
                    }
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground"
                      disabled={disabled}
                      aria-label={mentionLabel}
                      onClick={() => {
                        resetMention();
                      }}
                    >
                      <IconAt className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60 p-1">
                    <Input
                      autoFocus
                      value={mentionSearch}
                      onChange={(event) =>
                        setMentionSearch(event.currentTarget.value)
                      }
                      placeholder={mentionLabel}
                      aria-label={mentionLabel}
                      className="mb-1 h-8 text-xs"
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                    {filteredMentionOptions.length > 0 ? (
                      filteredMentionOptions.map((mention) => (
                        <DropdownMenuItem
                          key={`${mention.email ?? mention.id ?? mention.label}`}
                          onSelect={() => insertMention(mention)}
                        >
                          <span className="truncate">{mention.label}</span>
                          {mention.email ? (
                            <span className="ms-auto truncate text-xs text-muted-foreground">
                              {mention.email}
                            </span>
                          ) : null}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        {noMentionsLabel}
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {commentToolsEnd ? (
                <div data-review-comment-tools-end className="shrink-0">
                  {commentToolsEnd}
                </div>
              ) : null}
            </div>
          ) : null}
          {showCommentAction || showAgentAction ? (
            <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 @2xs/review:flex-row @2xs/review:justify-end">
              {showCommentAction ? (
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSubmit}
                  className="h-8 w-full gap-1.5 @2xs/review:w-auto @2xs/review:min-w-28 @2xs/review:shrink-0"
                >
                  {submittingTarget === "human" ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <IconMessageCircle className="size-3.5" />
                  )}
                  <span className="truncate">{commentLabel}</span>
                </Button>
              ) : null}
              {showAgentAction && agentAction ? (
                agentAction
              ) : showAgentAction ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canSubmit}
                  className="h-8 w-full min-w-0 gap-1.5 @2xs/review:w-auto"
                  onClick={() => submit("agent")}
                >
                  {submittingTarget === "agent" ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <IconSend className="size-3.5" />
                  )}
                  <span className="truncate">{agentLabel}</span>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
