import { useChatModels } from "@agent-native/core/client/agent-chat";
import { emailToColor } from "@agent-native/core/client/collab";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { resolveAgentProviderLogo } from "@agent-native/core/client/resources";
import {
  PromptComposer,
  type MentionItem,
  type ComposerTextSelection,
  type Reference,
  type TiptapComposerHandle,
} from "@agent-native/toolkit/composer";
import { IconArrowUp, IconAt, IconMoodSmile } from "@tabler/icons-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MentionMember } from "@/hooks/use-mention-members";
import { cn } from "@/lib/utils";

import { modelDisplayName } from "./agent-identity";
import {
  CommentAiModelList,
  CommentAiSendControl,
  commentAiSelectionKey,
  modelAliases,
  type CommentAiMode,
  type CommentAiSelection,
} from "./CommentAiRecipient";
import { EmojiPickerPanel } from "./EmojiPicker";

export interface MentionEntry {
  email: string;
  name: string;
}

export function mentionLabel(member: MentionMember): string {
  return member.name?.trim() || member.email.split("@")[0];
}

export interface CommentAiSubmitPayload extends CommentAiSelection {
  intent: CommentAiMode;
  effort?: string;
}

export interface CommentAiDraft {
  selection: CommentAiSelection;
  mode: CommentAiMode;
}

interface CommentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onMentionAdd: (entry: MentionEntry) => void;
  onAiSubmit?: (payload: CommentAiSubmitPayload) => void;
  aiDraft?: CommentAiDraft | null;
  onAiDraftChange?: (draft: CommentAiDraft | null) => void;
  aiModelStorageKey?: string;
  onEscape?: () => void;
  onBlur?: () => void;
  onFocus?: () => void;
  onSelectionChange?: (selection: ComposerTextSelection) => void;
  /** Shows a Cancel button beside Send, for editing or a new comment. */
  onCancel?: () => void;
  members: MentionMember[];
  placeholder?: string;
  ariaLabel?: string;
  /** Accessible name for the send button. Defaults to "Comment". */
  submitLabel?: string;
  /** Keeps Send disabled even with text, e.g. while the target is invalid. */
  submitDisabled?: boolean;
  /**
   * Rest as a single-line field until focused or filled, the way the reply
   * box sits under a thread. New comments and edits start expanded.
   */
  collapsible?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

const AI_REFERENCE_TYPE = "content-comment-ai-recipient";
const MEMBER_REFERENCE_TYPE = "content-comment-member";
/** Avatar lookups are per-person requests; bound them for large orgs. */
const MEMBER_AVATAR_PROBE_LIMIT = 40;

function providerMedia(selection: CommentAiSelection) {
  const identity = resolveAgentProviderLogo(
    selection.engine,
    selection.provider,
  );
  return identity.logoUrl
    ? ({ type: "image", src: identity.logoUrl } as const)
    : ({ type: "text", text: selection.provider.slice(0, 1) } as const);
}

function aiReference(draft: CommentAiDraft) {
  return {
    label: modelDisplayName(draft.selection.model),
    icon: "agent",
    media: providerMedia(draft.selection),
    source: "content",
    refType: AI_REFERENCE_TYPE,
    refId: commentAiSelectionKey(draft.selection),
    metadata: { selection: draft.selection },
  };
}

function memberInitial(member: MentionMember) {
  return (mentionLabel(member)[0] ?? "?").toUpperCase();
}

/** Reports one member's avatar URL; renders nothing. */
function MemberAvatarProbe({
  email,
  onUrl,
}: {
  email: string;
  onUrl: (email: string, url: string | null) => void;
}) {
  const url = useAvatarUrl(email);
  useEffect(() => onUrl(email, url), [email, url, onUrl]);
  return null;
}

function ComposerToolButton({
  label,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onMouseDown={(event) => event.preventDefault()}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
            className,
          )}
          {...props}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const CommentComposer = forwardRef<
  TiptapComposerHandle,
  CommentComposerProps
>(function CommentComposer(
  {
    value,
    onChange,
    onSubmit,
    onMentionAdd,
    onAiSubmit,
    aiDraft = null,
    onAiDraftChange,
    aiModelStorageKey,
    onEscape,
    onBlur,
    onFocus,
    onSelectionChange,
    onCancel,
    members,
    placeholder,
    ariaLabel,
    submitLabel,
    submitDisabled = false,
    collapsible = false,
    autoFocus,
    disabled = false,
    className,
  },
  forwardedRef,
) {
  const t = useT();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<TiptapComposerHandle>(null);
  const [composerReady, setComposerReady] = useState(false);
  const bindComposer = useCallback((handle: TiptapComposerHandle | null) => {
    composerRef.current = handle;
    if (handle) setComposerReady(true);
  }, []);
  const observedMemberIds = useRef(new Set<string>());
  const aiReferenceSeen = useRef(false);
  const hydratingControlledText = useRef(false);
  const lastEditorValue = useRef(value);
  const aiEnabled = Boolean(onAiSubmit && onAiDraftChange && aiModelStorageKey);
  const models = useChatModels({
    enabled: aiEnabled,
    storageKey: aiModelStorageKey ?? null,
    unavailableSelectionPolicy: "require-explicit",
  });
  const aiDraftRef = useRef(aiDraft);
  const onAiDraftChangeRef = useRef(onAiDraftChange);
  const onMentionAddRef = useRef(onMentionAdd);
  const onModelChangeRef = useRef(models.onModelChange);
  aiDraftRef.current = aiDraft;
  onAiDraftChangeRef.current = onAiDraftChange;
  onMentionAddRef.current = onMentionAdd;
  onModelChangeRef.current = models.onModelChange;

  const [focused, setFocused] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [modelMenuRect, setModelMenuRect] = useState<DOMRect | null>(null);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>(
    {},
  );
  const reportAvatarUrl = useCallback(
    (email: string, url: string | null) =>
      setAvatarUrls((current) =>
        current[email] === url ? current : { ...current, [email]: url },
      ),
    [],
  );

  const hasText = value.trim().length > 0;
  const expanded =
    !collapsible ||
    focused ||
    emojiOpen ||
    modelMenuRect !== null ||
    hasText ||
    Boolean(aiDraft);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => composerRef.current?.focus(),
    insertText: (text) => composerRef.current?.insertText(text),
    insertTextAtCursor: (text) =>
      composerRef.current?.insertTextAtCursor?.(text),
    setText: (text) => composerRef.current?.setText(text),
    insertReference: (reference) =>
      composerRef.current?.insertReference(reference),
    replaceReference: (refType, reference) =>
      composerRef.current?.replaceReference(refType, reference),
    getSelection: () => composerRef.current?.getSelection() ?? null,
    setSelection: (start, end, direction) =>
      composerRef.current?.setSelection(start, end, direction),
    dismissPopover: () => composerRef.current?.dismissPopover() ?? false,
  }));

  const connectedModels = useMemo<CommentAiSelection[]>(
    () =>
      (models.configuredModels ?? []).flatMap((group) =>
        group.models.map((model) => ({
          model,
          engine: group.engine,
          provider: group.label,
        })),
      ),
    [models.configuredModels],
  );

  const mentionItems = useMemo<MentionItem[]>(() => {
    const memberItems = members.map((member) => {
      const label = mentionLabel(member);
      const avatarUrl = avatarUrls[member.email];
      return {
        id: `member:${member.email}`,
        label,
        description: member.email,
        section: t("comments.mentionPeople"),
        source: "content",
        refType: MEMBER_REFERENCE_TYPE,
        refId: member.email,
        media: avatarUrl
          ? ({ type: "image", src: avatarUrl, fit: "cover" } as const)
          : ({
              type: "text",
              text: memberInitial(member),
              backgroundColor: emailToColor(member.email),
            } as const),
        metadata: { email: member.email, name: label },
      };
    });
    if (!aiEnabled) return memberItems;
    const agentsSection = t("comments.mentionAgents");
    const aiItems = connectedModels.map((selection) => ({
      id: `ai:${commentAiSelectionKey(selection)}`,
      label: modelDisplayName(selection.model),
      description: selection.provider,
      aliases: modelAliases(selection.model),
      replaceExisting: true,
      section: agentsSection,
      source: "content",
      refType: AI_REFERENCE_TYPE,
      refId: commentAiSelectionKey(selection),
      media: providerMedia(selection),
      metadata: { selection },
    }));
    const selected = models.selectionReady
      ? connectedModels.find(
          (candidate) =>
            candidate.model === models.selectedModel &&
            candidate.engine === models.selectedEngine,
        )
      : undefined;
    return [
      ...(selected
        ? [
            {
              ...aiItems.find(
                (item) => item.refId === commentAiSelectionKey(selected),
              )!,
              id: "ai",
              label: "AI",
              referenceLabel: modelDisplayName(selected.model),
              aliases: ["AI"],
              description: modelDisplayName(selected.model),
            },
          ]
        : []),
      ...aiItems,
      ...memberItems,
    ];
  }, [
    aiEnabled,
    avatarUrls,
    connectedModels,
    members,
    models.selectedEngine,
    models.selectedModel,
    models.selectionReady,
    t,
  ]);

  useEffect(() => {
    if (!composerReady || (!aiDraft && !aiReferenceSeen.current)) return;
    const timer = setTimeout(() => {
      composerRef.current?.replaceReference(
        AI_REFERENCE_TYPE,
        aiDraft ? aiReference(aiDraft) : null,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [aiDraft, composerReady]);

  useEffect(() => {
    if (!composerReady || value === lastEditorValue.current) return;
    lastEditorValue.current = value;
    hydratingControlledText.current = true;
    composerRef.current?.setText(value);
    const currentAiDraft = aiDraftRef.current;
    if (currentAiDraft) {
      composerRef.current?.replaceReference(
        AI_REFERENCE_TYPE,
        aiReference(currentAiDraft),
      );
    }
    hydratingControlledText.current = false;
  }, [composerReady, value]);

  const handleReferencesChange = useCallback((references: Reference[]) => {
    const currentAiDraft = aiDraftRef.current;
    const ai = [...references]
      .reverse()
      .find((reference) => reference.refType === AI_REFERENCE_TYPE);
    if (ai) aiReferenceSeen.current = true;
    if (ai) {
      const selection = (
        ai.metadata as { selection?: CommentAiSelection } | undefined
      )?.selection;
      const selectionChanged =
        selection &&
        (!currentAiDraft ||
          selection.model !== currentAiDraft.selection.model ||
          selection.engine !== currentAiDraft.selection.engine ||
          selection.provider !== currentAiDraft.selection.provider);
      if (selectionChanged) {
        const nextDraft = {
          selection,
          mode: currentAiDraft?.mode ?? ("auto" as const),
        };
        aiDraftRef.current = nextDraft;
        onModelChangeRef.current(selection.model, selection.engine);
        onAiDraftChangeRef.current?.(nextDraft);
      }
    } else if (
      !hydratingControlledText.current &&
      currentAiDraft &&
      aiReferenceSeen.current
    ) {
      aiReferenceSeen.current = false;
      aiDraftRef.current = null;
      onAiDraftChangeRef.current?.(null);
    }
    for (const reference of references) {
      if (reference.refType !== MEMBER_REFERENCE_TYPE || !reference.refId)
        continue;
      if (observedMemberIds.current.has(reference.refId)) continue;
      observedMemberIds.current.add(reference.refId);
      onMentionAddRef.current({
        email: reference.refId,
        name: reference.name,
      });
    }
    for (const id of [...observedMemberIds.current]) {
      if (
        !references.some(
          (reference) =>
            reference.refType === MEMBER_REFERENCE_TYPE &&
            reference.refId === id,
        )
      ) {
        observedMemberIds.current.delete(id);
      }
    }
  }, []);

  const changeModel = (selection: CommentAiSelection) => {
    setModelMenuRect(null);
    if (!aiDraft) return;
    models.onModelChange(selection.model, selection.engine);
    onAiDraftChange?.({ ...aiDraft, selection });
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const canSend = hasText && !disabled && !submitDisabled;
  const submitAi = () => {
    if (!aiDraft || !onAiSubmit || !canSend || !models.selectionReady) return;
    onAiSubmit({
      ...aiDraft.selection,
      intent: aiDraft.mode,
      effort: models.selectedEffort,
    });
  };
  // One send path for Enter and the button, so an AI recipient can never be
  // bypassed by a second, human-only submit control.
  const submit = () => {
    if (aiDraft) submitAi();
    else if (canSend) onSubmit();
  };
  const sendLabel = submitLabel ?? t("comments.submit");

  const toolbar = expanded ? (
    <div className="flex items-center gap-0.5" data-comment-composer-tools>
      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
        <PopoverTrigger asChild>
          <ComposerToolButton
            label={t("comments.addEmoji")}
            disabled={disabled}
          >
            <IconMoodSmile size={18} />
          </ComposerToolButton>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            composerRef.current?.focus();
          }}
        >
          <EmojiPickerPanel
            autoFocus={emojiOpen}
            onSelect={(emoji) => {
              setEmojiOpen(false);
              requestAnimationFrame(() =>
                composerRef.current?.insertTextAtCursor?.(emoji),
              );
            }}
          />
        </PopoverContent>
      </Popover>
      <ComposerToolButton
        label={t("comments.mentionSomeone")}
        disabled={disabled}
        onClick={() => composerRef.current?.insertTextAtCursor?.("@")}
      >
        <IconAt size={18} />
      </ComposerToolButton>
    </div>
  ) : null;

  const sendControl = aiDraft ? (
    <CommentAiSendControl
      mode={aiDraft.mode}
      disabled={!canSend || !models.selectionReady}
      onModeChange={(mode) => onAiDraftChange?.({ ...aiDraft, mode })}
      onSubmit={submitAi}
      models={connectedModels}
      selected={aiDraft.selection}
      onModelChange={changeModel}
    />
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={sendLabel}
          data-comment-send
          disabled={!canSend}
          onMouseDown={(event) => event.preventDefault()}
          onClick={submit}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:bg-muted-foreground/45"
        >
          <IconArrowUp size={16} stroke={2.25} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{sendLabel}</TooltipContent>
    </Tooltip>
  );

  return (
    <div
      ref={wrapperRef}
      data-comment-composer
      data-state={expanded ? "expanded" : "resting"}
      className={cn("relative min-w-0", className)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && wrapperRef.current?.contains(next)) return;
        setFocused(false);
      }}
      onClickCapture={(event) => {
        if (!aiDraft || connectedModels.length < 2) return;
        const pill = (event.target as HTMLElement).closest<HTMLElement>(
          `[data-mention-ref-type="${AI_REFERENCE_TYPE}"]`,
        );
        if (!pill) return;
        event.preventDefault();
        setModelMenuRect(pill.getBoundingClientRect());
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || !event.defaultPrevented) return;
        if (
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229
        ) {
          event.stopPropagation();
          return;
        }
        if (!composerRef.current?.dismissPopover()) onEscape?.();
        event.stopPropagation();
      }}
    >
      <PromptComposer
        composerRef={bindComposer}
        initialText={value}
        initialTextKey="comment-composer-controlled"
        onTextChange={(text) => {
          if (text === lastEditorValue.current) return;
          lastEditorValue.current = text;
          onChange(text);
        }}
        onSubmit={submit}
        mentionItems={mentionItems}
        mentionPopoverDensity="stacked"
        includeDefaultMentionSearch={false}
        onReferencesChange={handleReferencesChange}
        onEscape={onEscape}
        onFocus={onFocus}
        onBlur={onBlur}
        onSelectionChange={onSelectionChange}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        autoFocus={autoFocus}
        disabled={disabled}
        attachmentsEnabled={false}
        plusMenuMode="hidden"
        voiceEnabled={false}
        showModelSelector={false}
        requireAgentEngine={false}
        modelStatusChecksEnabled={false}
        showAutoModelOption={false}
        layoutVariant="compact"
        toolbarSlot={toolbar}
        actionButton={
          <div className="flex items-center gap-1">
            {onCancel && expanded ? (
              <button
                type="button"
                onClick={onCancel}
                disabled={disabled}
                className="h-7 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {t("comments.cancel")}
              </button>
            ) : null}
            {sendControl}
          </div>
        }
        className="comment-composer-area"
        rootClassName="comment-composer-root min-w-0"
      />
      {aiEnabled && models.unavailableSelection ? (
        <span
          role="status"
          className="mt-1 block text-xs text-muted-foreground"
        >
          {t("comments.aiUnavailable")}
        </span>
      ) : null}
      {members.slice(0, MEMBER_AVATAR_PROBE_LIMIT).map((member) => (
        <MemberAvatarProbe
          key={member.email}
          email={member.email}
          onUrl={reportAvatarUrl}
        />
      ))}
      <Popover
        open={modelMenuRect !== null}
        onOpenChange={(open) => {
          if (!open) setModelMenuRect(null);
        }}
      >
        <PopoverAnchor
          virtualRef={{
            current: {
              getBoundingClientRect: () =>
                modelMenuRect ?? new DOMRect(0, 0, 0, 0),
            },
          }}
        />
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-64 p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <CommentAiModelList
            models={connectedModels}
            selected={aiDraft?.selection ?? null}
            onSelect={changeModel}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
});
