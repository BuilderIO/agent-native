import type {
  ReviewMention,
  ReviewResolutionTarget,
} from "@agent-native/core/review/types";
import { useFocusWithinThroughPress } from "@agent-native/toolkit/hooks/use-focus-within-through-press";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Popover, PopoverAnchor } from "@agent-native/toolkit/ui/popover";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconArrowUp,
  IconAt,
  IconFocus2,
  IconMoodSmile,
  IconPhoto,
  IconSend,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { toast } from "sonner";

import { isComposingKey, isCommentSendKey } from "./comment-send-key.js";
import {
  ReviewCommentImageStrip,
  useReviewCommentImageUpload,
  type ReviewCommentImage,
  type ReviewCommentImageUpload,
} from "./review-comment-images.js";
import {
  ReviewComposerEditor,
  type ReviewComposerEditorHandle,
} from "./ReviewComposerEditor.js";
import type { ReviewComposerFormatLabels } from "./ReviewComposerToolbar.js";
import {
  ReviewMentionPicker,
  reviewMentionOptionId,
  type ReviewMentionOption,
} from "./ReviewMentionPicker.js";

const DEFAULT_COMPOSER_EMOJIS = ["👍", "❤️", "🎉", "👀"] as const;
const NO_IMAGES: readonly ReviewCommentImage[] = [];
const EMAIL_LOCAL_PART_BOUNDARY = /(?:^|\s)[^\s@]*[\p{L}\p{N}][^\s@]*[+-]$/u;
const NAME_CHAR = /[\p{L}\p{M}\p{N}_]/u;
// Lists, quotes, code and links look and space out as the posted comment
// draws them. Code sits on the page's background, as the field is the shade
// a posted comment's code has. The placeholder shows on the box's only
// paragraph while it's empty: TipTap's empty-editor class misses a change that
// empties the box at once, such as sending.
const EDITOR_CLASS =
  "min-w-0 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-foreground outline-none [&_p]:m-0 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-2.5 [&_blockquote]:text-muted-foreground [&>ul]:my-2 [&>ol]:my-2 [&>blockquote]:my-2 [&>pre]:my-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_pre]:whitespace-pre-wrap [&_pre]:rounded [&_pre]:bg-background [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&>p.is-empty:only-child]:before:pointer-events-none [&>p.is-empty:only-child]:before:float-start [&>p.is-empty:only-child]:before:h-0 [&>p.is-empty:only-child]:before:text-muted-foreground [&>p.is-empty:only-child]:before:content-[attr(data-placeholder)]";

export interface ReviewCommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (resolutionTarget: ReviewResolutionTarget) => void;
  mentions?: readonly ReviewMention[] | undefined;
  onMentionsChange?: ((mentions: ReviewMention[]) => void) | undefined;
  mentionOptions?: readonly ReviewMentionOption[] | undefined;
  /**
   * Called with the text after an `@` as it changes, and with "" once the
   * picker closes. A host that searches its people list server-side narrows
   * `mentionOptions` from it.
   */
  onMentionQueryChange?: ((query: string) => void) | undefined;
  /**
   * True while the host's answer to the current query is still on its way.
   * With no option matching yet, the picker stays hidden rather than say
   * "No people found" before the host has said so.
   */
  mentionOptionsLoading?: boolean | undefined;
  /**
   * True when the host could not get its people for the current query. With no
   * option matching, the picker says so instead of "No people found".
   */
  mentionOptionsFailed?: boolean | undefined;
  showCommentTools?: boolean | undefined;
  /** Rendered at the end of the left tools group, e.g. an image button. */
  commentToolsEnd?: ReactNode;
  /** Rendered between the text and the toolbar, under any images. */
  attachments?: ReactNode;
  /**
   * The comment's images. With `onImagesChange`, the box takes up to five
   * from its image button, a paste or a drop, shows them over its toolbar,
   * and sends with images alone.
   */
  images?: readonly ReviewCommentImage[] | undefined;
  onImagesChange?: ((images: ReviewCommentImage[]) => void) | undefined;
  /** Uploads one image; the app's own file upload unless given. */
  uploadImage?: ReviewCommentImageUpload | undefined;
  /** Hears an image that couldn't upload; a toast says so unless given. */
  onImageUploadError?: ((error: unknown) => void) | undefined;
  attachImageLabel?: string | undefined;
  removeImageLabel?: string | undefined;
  imageUploadFailedLabel?: string | undefined;
  emojiChoices?: readonly string[];
  emojiLabel?: string | undefined;
  mentionLabel?: string | undefined;
  agentsLabel?: string | undefined;
  noMentionsLabel?: string | undefined;
  mentionFailedLabel?: string | undefined;
  /** Names for the formatting bar over selected text and its link field. */
  formatLabels?: Partial<ReviewComposerFormatLabels> | undefined;
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
  /**
   * Enter sends, Shift+Enter starts a new line, and Cmd/Ctrl+Enter sends too,
   * as in every comment box. Pass `false` to make Enter start a new line,
   * leaving Cmd/Ctrl+Enter to send.
   */
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
  onMentionQueryChange,
  mentionOptionsLoading = false,
  mentionOptionsFailed = false,
  showCommentTools = false,
  commentToolsEnd,
  attachments,
  images = NO_IMAGES,
  onImagesChange,
  uploadImage,
  onImageUploadError,
  attachImageLabel = "Attach image",
  removeImageLabel = "Remove image",
  imageUploadFailedLabel = "Couldn't upload the image",
  emojiChoices = DEFAULT_COMPOSER_EMOJIS,
  emojiLabel = "Add emoji",
  mentionLabel = "Mention someone",
  agentsLabel = "Agents",
  noMentionsLabel = "No people found",
  mentionFailedLabel = "Couldn't load people",
  formatLabels,
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
  submitOnEnter = true,
  enterSubmitTarget = "human",
  onEscape,
  variant = "expanded",
  textareaProps,
  className,
}: ReviewCommentComposerProps) {
  const resolvedPlaceholder =
    placeholder ?? (variant === "reply" ? "Reply" : "Add a comment...");
  const showAgent = showAgentAction ?? Boolean(agentAction);
  const imagesOn = onImagesChange !== undefined;
  const imageUpload = useReviewCommentImageUpload({
    images,
    onImagesChange,
    upload: uploadImage,
    onUploadError:
      onImageUploadError ?? (() => toast.error(imageUploadFailedLabel)),
    disabled,
  });
  const imageInputRef = useRef<HTMLInputElement>(null);
  // An image is a comment on its own, once it's uploaded.
  const canSubmit =
    (Boolean(value.trim()) || images.length > 0) &&
    !disabled &&
    !imageUpload.uploading;
  const editorRef = useRef<ReviewComposerEditorHandle>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [editorReady, setEditorReady] = useState(false);
  const { focused, focusWithinProps } = useFocusWithinThroughPress(fieldRef);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  // Only a typed `@` (or the toolbar button) arms the picker, so moving the
  // caret into an older "@name" never reopens it.
  const mentionArmedRef = useRef(false);
  const mentionQueryRef = useRef("");
  const mentionListboxId = useId();
  const onMentionQueryChangeRef = useRef(onMentionQueryChange);
  useEffect(() => {
    onMentionQueryChangeRef.current = onMentionQueryChange;
  });
  // A card dismissed with the picker open never reaches `closeMention`, and the
  // host would keep narrowing the next composer's list by this one's query.
  useEffect(
    () => () => {
      if (mentionQueryRef.current !== "") onMentionQueryChangeRef.current?.("");
    },
    [],
  );

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

  // A host that searches server-side can answer a typed query with no one at
  // all; the picker then says so instead of closing under the caret.
  const mentionMenuOpen =
    mentionOpen &&
    (mentionOptions.length > 0 ||
      (onMentionQueryChange !== undefined && mentionQuery !== ""));

  const filteredMentionOptions = mentionOptions.filter((mention) => {
    const query = mentionQuery.trim().toLowerCase();
    return (
      !query ||
      mention.label.toLowerCase().includes(query) ||
      mention.email?.toLowerCase().includes(query) ||
      mention.description?.toLowerCase().includes(query)
    );
  });
  const activeMentionIndex = Math.min(
    mentionActiveIndex,
    Math.max(filteredMentionOptions.length - 1, 0),
  );
  const mentionListOpen = mentionMenuOpen && filteredMentionOptions.length > 0;
  const mentionAwaitingHost =
    mentionMenuOpen &&
    mentionOptionsLoading &&
    !mentionOptionsFailed &&
    filteredMentionOptions.length === 0;
  const mentionEmptyLabel = mentionOptionsFailed
    ? mentionFailedLabel
    : noMentionsLabel;

  const closeMention = () => {
    mentionArmedRef.current = false;
    if (mentionQueryRef.current !== "") onMentionQueryChange?.("");
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
      onMentionQueryChange?.(trigger.query);
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
  const insertMention = (option: ReviewMentionOption) => {
    const trigger = editorRef.current?.getMentionTrigger();
    const nextValue = trigger
      ? editorRef.current?.insertMention(option, trigger.from)
      : null;
    if (nextValue == null) return;
    onChange(nextValue);
    // `description` is picker-only: stored mentions keep the comment's shape.
    const { description: _description, ...mention } = option;
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
    // While an input method is composing, its keys (Escape to cancel, arrows
    // to pick a candidate, Enter to confirm) belong to it.
    if (isComposingKey(event)) return false;
    if (event.key === "Escape") {
      if (mentionMenuOpen) {
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
    if (mentionListOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const count = filteredMentionOptions.length;
        setMentionActiveIndex((activeMentionIndex + step + count) % count);
        return true;
      }
      // Shift+Enter still starts a line, and Cmd/Ctrl+Enter still sends.
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
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
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !editorRef.current?.isInCode()
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
    // In a list or code block, Enter goes on with it, as in a document. Enter
    // on an empty list item ends the list, and the next Enter sends.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      editorRef.current?.enterContinuesBlock()
    ) {
      return false;
    }
    if (
      isCommentSendKey(event) &&
      (submitOnEnter || event.metaKey || event.ctrlKey)
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
    images.length > 0 ||
    imageUpload.uploading ||
    emojiOpen ||
    mentionMenuOpen;
  const hasTools = showCommentTools || Boolean(commentToolsEnd) || imagesOn;
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
      <Popover
        open={mentionMenuOpen && !mentionAwaitingHost}
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
          {...focusWithinProps}
          onDragOver={(event) => {
            if (imagesOn && event.dataTransfer.types.includes("Files"))
              event.preventDefault();
          }}
          // A drop on the editor is its own; this takes one on the rest of
          // the field.
          onDrop={(event) => {
            if (!imagesOn || event.defaultPrevented) return;
            if (imageUpload.addFiles(Array.from(event.dataTransfer.files)))
              event.preventDefault();
          }}
          onClick={(event) => {
            if (
              !disabled &&
              !(event.target as HTMLElement).closest("button, [role=textbox]")
            )
              editorRef.current?.focus("end");
          }}
        >
          <PopoverAnchor asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
            />
          </PopoverAnchor>
          <div className={cn(!expanded && "flex h-10 items-center gap-2 px-3")}>
            <div className={cn(expanded ? "px-2 pb-4 pt-2" : "min-w-0 flex-1")}>
              <ReviewComposerEditor
                ref={editorRef}
                value={value}
                mentions={mentions}
                placeholder={resolvedPlaceholder}
                disabled={disabled}
                attributes={editorAttributes}
                combobox={
                  mentionOptions.length > 0
                    ? {
                        controls: mentionListOpen
                          ? mentionListboxId
                          : undefined,
                        activeDescendant: mentionListOpen
                          ? reviewMentionOptionId(
                              mentionListboxId,
                              activeMentionIndex,
                            )
                          : undefined,
                      }
                    : undefined
                }
                className={cn(EDITOR_CLASS, expanded && "min-h-10")}
                formatLabels={formatLabels}
                onTextChange={updateValue}
                onCaretChange={syncMention}
                onKeyDown={handleKeyDown}
                onImageFiles={imagesOn ? imageUpload.addFiles : undefined}
                onReady={() => setEditorReady(true)}
              />
            </div>
            {expanded ? null : sendButton}
          </div>
          {expanded && (images.length > 0 || attachments) ? (
            <div
              data-review-composer-attachments=""
              className="flex flex-col gap-1.5 px-2 pb-2"
            >
              <ReviewCommentImageStrip
                images={images}
                onRemove={
                  onImagesChange
                    ? (index) =>
                        onImagesChange(
                          images.filter((_, current) => current !== index),
                        )
                    : undefined
                }
                removeLabel={removeImageLabel}
                disabled={disabled}
              />
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
                        className="flex w-auto gap-0.5"
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
                  {imagesOn ? (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        data-review-image-button=""
                        className="size-7 rounded-full text-muted-foreground"
                        disabled={disabled || imageUpload.remaining === 0}
                        aria-label={attachImageLabel}
                        onClick={() => imageInputRef.current?.click()}
                      >
                        {imageUpload.uploading ? (
                          <Spinner className="size-4" />
                        ) : (
                          <IconPhoto className="size-4" />
                        )}
                      </Button>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        data-review-image-input=""
                        // The button above is the one named, tabbable control,
                        // and it clicks this input.
                        tabIndex={-1}
                        aria-hidden="true"
                        className="hidden"
                        onChange={(event) => {
                          imageUpload.addFiles(
                            Array.from(event.currentTarget.files ?? []),
                          );
                          event.currentTarget.value = "";
                        }}
                      />
                    </>
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
          emptyLabel={mentionEmptyLabel}
          agentsLabel={agentsLabel}
          listboxId={mentionListboxId}
          // The popover hears Escape on the document before the editor does and
          // closes itself. Swallow the key so nothing outside takes the same
          // press as "leave the composer"; the next Escape reaches `onEscape`.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onInteractOutside={(event) => {
            // A press in the field moves the caret, and `syncMention` decides
            // whether the list stays. Focus moving elsewhere in the field
            // (Tab) still closes it.
            if (
              event.detail.originalEvent.type === "pointerdown" &&
              fieldRef.current?.contains(event.target as Node)
            )
              event.preventDefault();
          }}
        />
      </Popover>
      <div role="status" aria-live="polite" className="sr-only">
        {mentionMenuOpen &&
        !mentionAwaitingHost &&
        filteredMentionOptions.length === 0
          ? mentionEmptyLabel
          : ""}
      </div>
    </form>
  );
}
