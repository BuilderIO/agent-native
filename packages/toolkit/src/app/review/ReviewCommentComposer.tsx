import type {
  ReviewMention,
  ReviewResolutionTarget,
} from "@agent-native/core/review/types";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconArrowUp,
  IconAt,
  IconFocus2,
  IconMoodSmile,
  IconSend,
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import {
  ReviewComposerEditor,
  type ReviewComposerEditorHandle,
} from "./ReviewComposerEditor.js";
import { ReviewMentionPicker } from "./ReviewMentionPicker.js";

const DEFAULT_COMPOSER_EMOJIS = ["👍", "❤️", "🎉", "👀"] as const;
const EMAIL_LOCAL_PART_BOUNDARY = /(?:^|\s)[^\s@]*[\p{L}\p{N}][^\s@]*[+-]$/u;
const NAME_CHAR = /[\p{L}\p{M}\p{N}_]/u;
const EDITOR_CLASS =
  "min-w-0 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-foreground outline-none [&>p]:m-0 [&>p.is-editor-empty:first-child]:before:pointer-events-none [&>p.is-editor-empty:first-child]:before:float-start [&>p.is-editor-empty:first-child]:before:h-0 [&>p.is-editor-empty:first-child]:before:text-muted-foreground [&>p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]";

export interface ReviewCommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (resolutionTarget: ReviewResolutionTarget) => void;
  mentions?: readonly ReviewMention[] | undefined;
  onMentionsChange?: ((mentions: ReviewMention[]) => void) | undefined;
  mentionOptions?: readonly ReviewMention[] | undefined;
  showCommentTools?: boolean | undefined;
  /** Rendered at the end of the left tools group, e.g. an image button. */
  commentToolsEnd?: ReactNode;
  /** Rendered between the text and the toolbar, e.g. image thumbnails. */
  attachments?: ReactNode;
  emojiChoices?: readonly string[];
  emojiLabel?: string | undefined;
  mentionLabel?: string | undefined;
  noMentionsLabel?: string | undefined;
  submittingTarget?: ReviewResolutionTarget | null | undefined;
  disabled?: boolean | undefined;
  showCommentAction?: boolean;
  /**
   * Show the agent action. Defaults to whether `agentAction` is passed, so the
   * composer has no agent control unless a consumer asks for one.
   */
  showAgentAction?: boolean;
  agentAction?: ReactNode;
  placeholder?: string | undefined;
  commentLabel?: string | undefined;
  agentLabel?: string;
  contextLabel?: string | undefined;
  autoFocus?: boolean | undefined;
  submitOnEnter?: boolean | undefined;
  enterSubmitTarget?: ReviewResolutionTarget;
  onEscape?: (() => void) | undefined;
  /**
   * `expanded` is always the full editor with its toolbar. `reply` is a
   * one-line field that grows into the editor on focus or once it has content.
   */
  variant?: "expanded" | "reply";
  /** Only `aria-*`, `data-*` and `id` reach the editor. */
  textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement> &
    Record<string, unknown>;
  className?: string | undefined;
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
  attachments,
  emojiChoices = DEFAULT_COMPOSER_EMOJIS,
  emojiLabel = "Add emoji",
  mentionLabel = "Mention someone",
  noMentionsLabel = "No people found",
  submittingTarget = null,
  disabled = false,
  showCommentAction = true,
  showAgentAction,
  agentAction,
  placeholder,
  commentLabel = "Comment",
  agentLabel = "Send to agent",
  contextLabel,
  autoFocus = false,
  submitOnEnter = false,
  enterSubmitTarget = "human",
  onEscape,
  variant = "expanded",
  textareaProps,
  className,
}: ReviewCommentComposerProps) {
  const resolvedPlaceholder =
    placeholder ?? (variant === "reply" ? "Reply" : "Add a comment...");
  const showAgent = showAgentAction ?? Boolean(agentAction);
  const canSubmit = Boolean(value.trim()) && !disabled;
  const editorRef = useRef<ReviewComposerEditorHandle>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  // Only a typed `@` (or the toolbar button) arms the picker, so moving the
  // caret into an older "@name" never reopens it.
  const mentionArmedRef = useRef(false);
  const mentionQueryRef = useRef("");
  const mentionEscapedRef = useRef(false);

  useEffect(() => {
    if (!autoFocus || !editorReady) return;
    // A menu item that opens this composer (Edit, say) mounts it while the
    // menu still traps focus, so keep trying for a few frames until it lands.
    let attempts = 0;
    let frame = 0;
    const focusEditor = () => {
      if (editorRef.current?.focus("end")) return;
      if (++attempts < 10) frame = requestAnimationFrame(focusEditor);
    };
    focusEditor();
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, editorReady]);

  const mentionPickerOpen = mentionOpen && mentionOptions.length > 0;
  useEffect(() => {
    if (!mentionPickerOpen) return;
    // Radix always moves focus into an opened menu, but the person is still
    // typing the name in the editor.
    const frame = requestAnimationFrame(() => editorRef.current?.focus("keep"));
    return () => cancelAnimationFrame(frame);
  }, [mentionPickerOpen]);

  const filteredMentionOptions = mentionOptions.filter((mention) => {
    const query = mentionQuery.trim().toLowerCase();
    return (
      !query ||
      mention.label.toLowerCase().includes(query) ||
      mention.email?.toLowerCase().includes(query)
    );
  });
  const mentionMenuOpen = mentionPickerOpen;
  const activeMentionIndex = Math.min(
    mentionActiveIndex,
    Math.max(filteredMentionOptions.length - 1, 0),
  );

  const closeMention = () => {
    mentionArmedRef.current = false;
    mentionQueryRef.current = "";
    setMentionOpen(false);
    setMentionQuery("");
    setMentionActiveIndex(0);
  };
  const syncMention = () => {
    if (!mentionArmedRef.current) return;
    const trigger = editorRef.current?.getMentionTrigger();
    if (!trigger) {
      closeMention();
      return;
    }
    setMentionOpen(true);
    if (mentionQueryRef.current !== trigger.query) {
      mentionQueryRef.current = trigger.query;
      setMentionQuery(trigger.query);
      setMentionActiveIndex(0);
    }
  };
  const armMention = () => {
    mentionArmedRef.current = true;
    syncMention();
  };

  const updateValue = (nextValue: string) => {
    onChange(nextValue);
    onMentionsChange?.(
      mentions.filter((mention) => nextValue.includes(`@${mention.label}`)),
    );
  };
  const insertMention = (mention: ReviewMention) => {
    const trigger = editorRef.current?.getMentionTrigger();
    const nextValue = trigger
      ? editorRef.current?.insertMention(mention, trigger.from)
      : null;
    if (nextValue == null) return;
    onChange(nextValue);
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
    closeMention();
  };
  const openMentionFromToolbar = () => {
    if (!mentionMenuOpen) {
      editorRef.current?.insertText("@");
      armMention();
    }
    editorRef.current?.focus("keep");
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
    if (preferred === "agent" && showAgent) {
      submit("agent");
      return;
    }
    if (showCommentAction) submit("human");
    else if (showAgent) submit("agent");
  };

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    if (event.key === "Escape") {
      if (mentionEscapedRef.current || mentionMenuOpen) {
        mentionEscapedRef.current = false;
        closeMention();
        event.stopPropagation();
        return true;
      }
      if (onEscape) {
        event.stopPropagation();
        event.preventDefault();
        onEscape();
        return true;
      }
      return false;
    }
    const isComposing = event.isComposing || event.keyCode === 229;
    if (mentionMenuOpen && filteredMentionOptions.length > 0 && !isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const count = filteredMentionOptions.length;
        setMentionActiveIndex((activeMentionIndex + step + count) % count);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const mention = filteredMentionOptions.at(activeMentionIndex);
        if (mention) {
          event.preventDefault();
          insertMention(mention);
          return true;
        }
      }
    }
    if (
      mentionOptions.length > 0 &&
      event.key === "@" &&
      !isComposing &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const textBefore = editorRef.current?.getTextBeforeCaret() ?? "";
      const previousCharacter = [...textBefore].pop();
      if (
        !EMAIL_LOCAL_PART_BOUNDARY.test(textBefore) &&
        !NAME_CHAR.test(previousCharacter ?? "")
      ) {
        event.preventDefault();
        mentionArmedRef.current = true;
        editorRef.current?.typeText("@");
        syncMention();
        return true;
      }
    }
    if (
      submitOnEnter &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !isComposing
    ) {
      event.preventDefault();
      submitVisibleAction(enterSubmitTarget);
      return true;
    }
    return false;
  };

  const editorAttributes: Record<string, string> = {
    "aria-label": resolvedPlaceholder,
  };
  for (const [name, attribute] of Object.entries(textareaProps ?? {})) {
    if (
      (name.startsWith("aria-") || name.startsWith("data-") || name === "id") &&
      attribute != null &&
      attribute !== false
    ) {
      editorAttributes[name] = String(attribute);
    }
  }

  const hasContent = value.length > 0;
  const expanded =
    variant === "expanded" ||
    focused ||
    hasContent ||
    Boolean(attachments) ||
    emojiOpen ||
    mentionMenuOpen;
  const hasTools = showCommentTools || Boolean(commentToolsEnd);
  const sendButton = showCommentAction ? (
    <Button
      type="submit"
      size="icon"
      disabled={!canSubmit}
      className="size-[22px] min-w-0 shrink-0 rounded-full p-0 disabled:opacity-50"
    >
      {submittingTarget === "human" ? (
        <Spinner className="size-3" />
      ) : (
        <IconArrowUp className="size-3" />
      )}
      <span className="sr-only">{commentLabel}</span>
    </Button>
  ) : null;

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
      <DropdownMenu
        modal={false}
        open={mentionMenuOpen}
        onOpenChange={(open) => {
          if (!open) closeMention();
        }}
      >
        <div
          ref={fieldRef}
          data-review-composer-field=""
          data-expanded={expanded ? "" : undefined}
          className={cn(
            "relative rounded-[10px] border bg-secondary text-sm",
            expanded
              ? "border-input focus-within:border-[color:var(--review-composer-focus,hsl(var(--ring)))]"
              : "border-transparent",
          )}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={(event) => {
            if (!fieldRef.current?.contains(event.relatedTarget as Node | null))
              setFocused(false);
          }}
          onClick={(event) => {
            if (
              !disabled &&
              !(event.target as HTMLElement).closest("button, [role=textbox]")
            )
              editorRef.current?.focus("end");
          }}
        >
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              tabIndex={-1}
              className="pointer-events-none absolute inset-0"
            />
          </DropdownMenuTrigger>
          <div className={cn(!expanded && "flex h-10 items-center gap-2 px-3")}>
            <div className={cn(expanded ? "px-2 pb-4 pt-2" : "min-w-0 flex-1")}>
              <ReviewComposerEditor
                ref={editorRef}
                value={value}
                mentions={mentions}
                placeholder={resolvedPlaceholder}
                disabled={disabled}
                attributes={editorAttributes}
                className={cn(EDITOR_CLASS, expanded && "min-h-10")}
                onTextChange={updateValue}
                onCaretChange={syncMention}
                onKeyDown={handleKeyDown}
                onReady={() => setEditorReady(true)}
              />
            </div>
            {expanded ? null : sendButton}
          </div>
          {expanded && attachments ? (
            <div data-review-composer-attachments="" className="px-2 pb-2">
              {attachments}
            </div>
          ) : null}
          {expanded ? (
            <div
              className="flex h-11 items-center gap-2 border-t border-border p-2"
              onMouseDown={(event) => {
                if (
                  (event.target as HTMLElement).closest(
                    "button, [role=button], label",
                  )
                )
                  event.preventDefault();
              }}
            >
              {hasTools ? (
                <div
                  data-review-comment-tools=""
                  className="flex min-w-0 items-center gap-1"
                >
                  {showCommentTools ? (
                    <DropdownMenu open={emojiOpen} onOpenChange={setEmojiOpen}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 rounded-full text-muted-foreground"
                          disabled={disabled}
                          aria-label={emojiLabel}
                        >
                          <IconMoodSmile className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        data-review-popover=""
                        align="start"
                        className="flex w-auto gap-0.5 p-1"
                        onCloseAutoFocus={(event) => {
                          event.preventDefault();
                          editorRef.current?.focus("keep");
                        }}
                      >
                        {emojiChoices.map((emoji) => (
                          <DropdownMenuItem
                            key={emoji}
                            className="size-8 justify-center p-0 text-base"
                            onSelect={() =>
                              editorRef.current?.insertText(emoji)
                            }
                          >
                            <span aria-hidden="true">{emoji}</span>
                            <span className="sr-only">{emoji}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  {showCommentTools && mentionOptions.length > 0 ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 rounded-full text-muted-foreground"
                      disabled={disabled}
                      aria-label={mentionLabel}
                      onClick={openMentionFromToolbar}
                    >
                      <IconAt className="size-4" />
                    </Button>
                  ) : null}
                  {commentToolsEnd ? (
                    <div data-review-comment-tools-end="" className="shrink-0">
                      {commentToolsEnd}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="ms-auto flex min-w-0 items-center gap-2">
                {showAgent && agentAction ? (
                  agentAction
                ) : showAgent ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canSubmit}
                    className="h-7 min-w-0 gap-1.5"
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
                {sendButton}
              </div>
            </div>
          ) : null}
        </div>
        <ReviewMentionPicker
          options={filteredMentionOptions}
          activeIndex={activeMentionIndex}
          onActiveIndexChange={setMentionActiveIndex}
          onSelect={insertMention}
          label={mentionLabel}
          emptyLabel={noMentionsLabel}
          onEscapeKeyDown={() => {
            mentionEscapedRef.current = true;
            window.setTimeout(() => {
              mentionEscapedRef.current = false;
            }, 0);
          }}
          onInteractOutside={(event) => {
            if (fieldRef.current?.contains(event.target as Node))
              event.preventDefault();
          }}
        />
      </DropdownMenu>
    </form>
  );
}
