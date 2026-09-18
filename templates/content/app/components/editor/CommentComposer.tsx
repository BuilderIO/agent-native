import { useChatModels } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { resolveAgentProviderLogo } from "@agent-native/core/client/resources";
import {
  PromptComposer,
  type MentionItem,
  type ComposerTextSelection,
  type Reference,
  type TiptapComposerHandle,
} from "@agent-native/toolkit/composer";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { MentionMember } from "@/hooks/use-mention-members";

import {
  CommentAiSendControl,
  modelFamilyAlias,
  type CommentAiMode,
  type CommentAiSelection,
} from "./CommentAiRecipient";

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
  members: MentionMember[];
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  rows?: number;
  className?: string;
}

const AI_REFERENCE_TYPE = "content-comment-ai-recipient";
const MEMBER_REFERENCE_TYPE = "content-comment-member";

function aiReference(draft: CommentAiDraft) {
  const providerLogo = resolveAgentProviderLogo(
    draft.selection.engine,
    draft.selection.provider,
  );
  return {
    label: `${draft.selection.provider} · ${modelFamilyAlias(draft.selection.model)}`,
    icon: "agent",
    media: providerLogo.logoUrl
      ? { type: "image" as const, src: providerLogo.logoUrl }
      : { type: "text" as const, text: draft.selection.provider.slice(0, 1) },
    source: "content",
    refType: AI_REFERENCE_TYPE,
    refId: `${draft.selection.engine}:${draft.selection.model}`,
    metadata: { selection: draft.selection },
  };
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
    members,
    placeholder,
    ariaLabel,
    autoFocus,
    disabled = false,
    className,
  },
  forwardedRef,
) {
  const t = useT();
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
  const models = useChatModels({
    enabled: Boolean(onAiSubmit && onAiDraftChange && aiModelStorageKey),
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

  useImperativeHandle(forwardedRef, () => ({
    focus: () => composerRef.current?.focus(),
    insertText: (text) => composerRef.current?.insertText(text),
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

  const connectedModels = useMemo(
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
        source: "content",
        refType: MEMBER_REFERENCE_TYPE,
        refId: member.email,
        metadata: { email: member.email, name: label },
      };
    });
    if (!onAiSubmit || !onAiDraftChange || !aiModelStorageKey)
      return memberItems;
    const aiItems = connectedModels.map((selection) => ({
      id: `ai:${selection.engine}:${selection.model}`,
      label: `${selection.provider} · ${modelFamilyAlias(selection.model)}`,
      aliases: [modelFamilyAlias(selection.model)],
      replaceExisting: true,
      source: "content",
      refType: AI_REFERENCE_TYPE,
      refId: `${selection.engine}:${selection.model}`,
      media: (() => {
        const identity = resolveAgentProviderLogo(
          selection.engine,
          selection.provider,
        );
        return identity.logoUrl
          ? ({ type: "image", src: identity.logoUrl } as const)
          : ({ type: "text", text: selection.provider.slice(0, 1) } as const);
      })(),
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
                (item) => item.refId === `${selected.engine}:${selected.model}`,
              )!,
              id: "ai",
              label: "AI",
              referenceLabel: `${selected.provider} · ${modelFamilyAlias(selected.model)}`,
              aliases: ["AI"],
              replaceExisting: true,
              description: `${selected.provider} · ${modelFamilyAlias(selected.model)}`,
            },
          ]
        : []),
      ...aiItems,
      ...memberItems,
    ];
  }, [
    aiModelStorageKey,
    aiDraft,
    connectedModels,
    members,
    models.selectedEngine,
    models.selectedModel,
    models.selectionReady,
    onAiDraftChange,
    onAiSubmit,
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

  const submitAi = () => {
    if (!aiDraft || !onAiSubmit) return;
    onAiSubmit({
      ...aiDraft.selection,
      intent: aiDraft.mode,
      effort: models.selectedEffort,
    });
  };

  return (
    <div
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
        onSubmit={() => {
          if (aiDraft) submitAi();
          else onSubmit();
        }}
        mentionItems={mentionItems}
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
        showModelSelector={Boolean(aiDraft)}
        showAutoModelOption={false}
        availableModels={models.configuredModels}
        selectedModel={aiDraft?.selection.model ?? models.selectedModel}
        selectedEngine={aiDraft?.selection.engine ?? models.selectedEngine}
        selectedEffort={models.selectedEffort}
        onModelChange={(model, engine) => {
          const selection = connectedModels.find(
            (candidate) =>
              candidate.model === model && candidate.engine === engine,
          );
          if (!selection || !aiDraft) return;
          models.onModelChange(model, engine);
          onAiDraftChange?.({ ...aiDraft, selection });
        }}
        onEffortChange={models.onEffortChange}
        actionButton={
          aiDraft ? (
            <CommentAiSendControl
              mode={aiDraft.mode}
              disabled={disabled || !value.trim() || !models.selectionReady}
              onModeChange={(mode) => onAiDraftChange?.({ ...aiDraft, mode })}
              onSubmit={submitAi}
            />
          ) : undefined
        }
        className={className}
        rootClassName="min-w-0"
      />
      {onAiSubmit && aiModelStorageKey && models.unavailableSelection ? (
        <span role="status" className="text-xs text-muted-foreground">
          {t("comments.aiUnavailable")}
        </span>
      ) : null}
    </div>
  );
});
