import { useChatModels } from "@agent-native/core/client/agent-chat";
import { useAvatarUrl } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  PromptComposer,
  type MentionItem,
  type ComposerTextReference,
  type ComposerTextSelection,
  type Reference,
  type TiptapComposerHandle,
} from "@agent-native/toolkit/composer";
import {
  commentMentionKey,
  findCommentMentions,
  followsNameCharacter,
  isMentionNameAt,
  literalAtSignTest,
  type CommentAgentMention,
} from "@shared/comment-mentions";
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
import {
  useMentionMembers,
  type MentionMember,
} from "@/hooks/use-mention-members";
import { cn } from "@/lib/utils";

import { modelDisplayName } from "./agent-identity";
import {
  draftMention,
  sameMentions,
  type MentionEntry,
} from "./comment-drafts";
import {
  CommentAiModelList,
  CommentAiSendControl,
  commentAiSelectionKey,
  modelAliases,
  type CommentAiMode,
  type CommentAiSelection,
} from "./CommentAiRecipient";
import { agentMentionMedia, personMentionMedia } from "./CommentIdentity";
import { EmojiPickerPanel } from "./EmojiPicker";

/** The agent a comment is sent to, named the way its chip reads. */
export function aiRecipientMention(
  selection: CommentAiSelection,
): CommentAgentMention {
  return {
    kind: "agent",
    model: selection.model,
    engine: selection.engine,
    provider: selection.provider,
    name: modelDisplayName(selection.model),
  };
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
  /** Who the draft mentions, one per `@name` chip, in text order. */
  mentions: readonly MentionEntry[];
  /** Called with the chips, in text order, whenever they change. */
  onMentionsChange: (mentions: MentionEntry[]) => void;
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
/** An agent an existing comment mentions; unlike the recipient, it sends nothing. */
const AGENT_REFERENCE_TYPE = "content-comment-agent";
const MEMBER_REFERENCE_TYPE = "content-comment-member";
/** Avatar lookups are per-person requests; bound them for large orgs. */
const MEMBER_AVATAR_PROBE_LIMIT = 40;

function providerMedia(selection: CommentAiSelection) {
  return agentMentionMedia(
    selection.model,
    selection.engine,
    selection.provider,
  );
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

/** Reads the same as the chip a picked member item makes. */
function memberReference(person: { email: string; name: string }) {
  return {
    label: person.name,
    media: personMentionMedia(person.email, person.name, undefined),
    source: "content",
    refType: MEMBER_REFERENCE_TYPE,
    refId: person.email,
    metadata: { email: person.email, name: person.name },
  };
}

function agentReference(agent: CommentAgentMention) {
  return {
    label: agent.name,
    icon: "agent",
    media: agentMentionMedia(agent.model, agent.engine, agent.provider),
    source: "content",
    refType: AGENT_REFERENCE_TYPE,
    refId: commentMentionKey(agent),
    metadata: { mention: agent },
  };
}

/**
 * The chips a draft's plain text stands for, each at the `@name` its mention
 * resolves to; an agent's chip is the AI recipient when it is that agent. A
 * restored or edited draft gets its chips back this way, so the chips are
 * always who it mentions.
 */
function textReferences(
  text: string,
  mentions: readonly MentionEntry[],
  aiDraft: CommentAiDraft | null,
): ComposerTextReference[] {
  const recipient =
    aiDraft && commentMentionKey(aiRecipientMention(aiDraft.selection));
  const references: ComposerTextReference[] = findCommentMentions(
    text,
    mentions.map(draftMention),
  ).map(({ start, name, mention }) => ({
    start,
    end: start + 1 + name.length,
    reference:
      mention.kind === "person"
        ? memberReference(mention)
        : aiDraft && commentMentionKey(mention) === recipient
          ? aiReference(aiDraft)
          : agentReference(mention),
  }));
  if (
    !aiDraft ||
    references.some(({ reference }) => reference.refType === AI_REFERENCE_TYPE)
  )
    return references;
  // A draft saved before its mentions listed the AI chip. That chip was
  // appended after the text, so at the end it can follow a word directly.
  const ai = aiReference(aiDraft);
  const isLiteral = literalAtSignTest(text);
  for (
    let start = text.indexOf(`@${ai.label}`);
    start >= 0;
    start = text.indexOf(`@${ai.label}`, start + 1)
  ) {
    const end = start + 1 + ai.label.length;
    if (
      !isLiteral(start) &&
      (!followsNameCharacter(text, start) || !text.slice(end).trim()) &&
      isMentionNameAt(text, start, ai.label) &&
      !references.some(
        (reference) => reference.start < end && start < reference.end,
      )
    ) {
      references.push({ start, end, reference: ai });
      break;
    }
  }
  return references;
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
    mentions,
    onMentionsChange,
    onAiSubmit,
    aiDraft = null,
    onAiDraftChange,
    aiModelStorageKey,
    onEscape,
    onBlur,
    onFocus,
    onSelectionChange,
    onCancel,
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
  const membersQuery = useMentionMembers();
  const members = membersQuery.data ?? [];
  const wrapperRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<TiptapComposerHandle>(null);
  const [composerReady, setComposerReady] = useState(false);
  const bindComposer = useCallback((handle: TiptapComposerHandle | null) => {
    composerRef.current = handle;
    if (handle) setComposerReady(true);
  }, []);
  const [initialReferences] = useState(() =>
    textReferences(value, mentions, aiDraft),
  );
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
  const mentionsRef = useRef(mentions);
  const onMentionsChangeRef = useRef(onMentionsChange);
  const onModelChangeRef = useRef(models.onModelChange);
  aiDraftRef.current = aiDraft;
  onAiDraftChangeRef.current = onAiDraftChange;
  mentionsRef.current = mentions;
  onMentionsChangeRef.current = onMentionsChange;
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
    submitWithText: (text) =>
      composerRef.current?.submitWithText(text) ?? Promise.resolve(false),
    addAttachment: (file) =>
      composerRef.current?.addAttachment(file) ?? Promise.resolve(undefined),
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
      return {
        id: `member:${member.email}`,
        label,
        description: member.email,
        section: t("comments.mentionPeople"),
        source: "content",
        refType: MEMBER_REFERENCE_TYPE,
        refId: member.email,
        media: personMentionMedia(
          member.email,
          label,
          avatarUrls[member.email],
        ),
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
    const currentAiDraft = aiDraftRef.current;
    composerRef.current?.setText(
      value,
      textReferences(value, mentionsRef.current, currentAiDraft),
    );
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
    const aiReferences = references.filter(
      (reference) => reference.refType === AI_REFERENCE_TYPE,
    );
    const selectionOf = (reference: Reference) =>
      (reference.metadata as { selection?: CommentAiSelection } | undefined)
        ?.selection;
    // References arrive in document order; the newest pill is the one that
    // differs from the current draft.
    const ai =
      aiReferences.find((reference) => {
        const selection = selectionOf(reference);
        return (
          selection &&
          currentAiDraft &&
          commentAiSelectionKey(selection) !==
            commentAiSelectionKey(currentAiDraft.selection)
        );
      }) ?? aiReferences[aiReferences.length - 1];
    if (ai) aiReferenceSeen.current = true;
    if (ai) {
      const selection = selectionOf(ai);
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
      // A comment goes to one model. However a second model pill got in
      // (typed, pasted, or restored), keep only the newest one.
      const kept = aiDraftRef.current;
      if (aiReferences.length > 1 && kept) {
        setTimeout(() =>
          composerRef.current?.replaceReference(
            AI_REFERENCE_TYPE,
            aiReference(kept),
          ),
        );
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
    const mentions = references.flatMap((reference): MentionEntry[] => {
      if (reference.refType === MEMBER_REFERENCE_TYPE && reference.refId)
        return [{ email: reference.refId, name: reference.name }];
      const selection = selectionOf(reference);
      if (reference.refType === AI_REFERENCE_TYPE && selection)
        return [aiRecipientMention(selection)];
      const agent = (
        reference.metadata as { mention?: CommentAgentMention } | undefined
      )?.mention;
      return reference.refType === AGENT_REFERENCE_TYPE && agent ? [agent] : [];
    });
    if (!sameMentions(mentions, mentionsRef.current)) {
      mentionsRef.current = mentions;
      onMentionsChangeRef.current(mentions);
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
      data-model-switchable={
        aiDraft && connectedModels.length > 1 ? "" : undefined
      }
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
        initialReferences={initialReferences}
        onTextChange={(text) => {
          if (text === lastEditorValue.current) return;
          lastEditorValue.current = text;
          onChange(text);
        }}
        onSubmit={submit}
        mentionItems={mentionItems}
        mentionItemsError={
          membersQuery.isError
            ? t("comments.mentionPeopleLoadFailed")
            : undefined
        }
        onRetryMentionItems={() => void membersQuery.refetch()}
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
        modelStatusChecksEnabled={false}
        showAutoModelOption={false}
        layoutVariant="compact"
        toolbarSlot={toolbar}
        actionButton={
          <div className="flex shrink-0 items-center gap-1">
            {onCancel && expanded ? (
              <button
                type="button"
                onClick={onCancel}
                disabled={disabled}
                className="h-7 shrink-0 whitespace-nowrap rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
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
