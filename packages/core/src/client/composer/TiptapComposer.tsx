import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  useMemo,
} from "react";
import {
  ComposerPrimitive,
  useComposer,
  useComposerRuntime,
} from "@assistant-ui/react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { FileReference } from "./extensions/FileReference.js";
import { SkillReference } from "./extensions/SkillReference.js";
import { MentionReference } from "./extensions/MentionReference.js";
import { MentionPopover, type MentionPopoverRef } from "./MentionPopover.js";
import { useMentionSearch } from "./use-mention-search.js";
import { useSkills } from "./use-skills.js";
import {
  IconArrowUp,
  IconPlus,
  IconCheck,
  IconChevronDown,
} from "@tabler/icons-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import type {
  MentionItem,
  SkillResult,
  Reference,
  SlashCommand,
} from "./types.js";
import { useVoiceDictation } from "./useVoiceDictation.js";
import { VoiceButton, VoiceRecordingOverlay } from "./VoiceButton.js";
import { ComposerPlusMenu } from "./ComposerPlusMenu.js";

export interface TiptapComposerHandle {
  focus(): void;
}

const BUILT_IN_COMMANDS: SlashCommand[] = [
  { name: "clear", description: "Start a new chat", icon: "clear" },
  { name: "new", description: "Start a new chat", icon: "new" },
  { name: "history", description: "Browse chat history", icon: "history" },
  { name: "help", description: "Show available commands", icon: "help" },
];

type ExecMode = "build" | "plan";

interface TiptapComposerProps {
  placeholder?: string;
  disabled?: boolean;
  focusRef?: React.Ref<TiptapComposerHandle>;
  /** When provided, called instead of composerRuntime.send(). Used for queue mode. */
  onSubmit?: (text: string, references: Reference[]) => void;
  /** Custom action button (e.g. stop button) to render instead of the default send button. */
  actionButton?: React.ReactNode;
  /** Extra button to render alongside the default send button (e.g. stop while running). */
  extraActionButton?: React.ReactNode;
  /** Custom attachment button to render instead of ComposerPrimitive.AddAttachment. */
  attachButton?: React.ReactNode;
  /** Called when a slash command (e.g. /clear, /help) is executed */
  onSlashCommand?: (command: string) => void;
  /** Current execution mode (build/plan) */
  execMode?: ExecMode;
  /** Callback to change execution mode */
  onExecModeChange?: (mode: ExecMode) => void;
  /** Show the microphone button for voice dictation. Default true. */
  voiceEnabled?: boolean;
  /** Selected model override for this conversation */
  selectedModel?: string;
  /** Available models grouped by provider */
  availableModels?: Array<{
    engine: string;
    label: string;
    models: string[];
    configured: boolean;
  }>;
  /** Callback when user picks a model */
  onModelChange?: (model: string, engine: string) => void;
}

function ModeSelector({
  mode,
  onChange,
}: {
  mode: ExecMode;
  onChange: (mode: ExecMode) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          {mode === "build" ? "Act" : "Plan"}
          <IconChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={6}
          className="w-60 rounded-lg border border-border bg-popover shadow-lg z-50 py-1 animate-in fade-in-0 zoom-in-95"
          style={{ fontSize: 13 }}
        >
          <button
            type="button"
            onClick={() => {
              onChange("build");
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 px-3 py-2 hover:bg-accent/50 text-left"
          >
            <div className="flex-1 min-w-0">
              <span className="font-medium text-foreground text-[13px]">
                Act
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Generate and make edits directly
              </p>
            </div>
            {mode === "build" && (
              <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              onChange("plan");
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 px-3 py-2 hover:bg-accent/50 text-left"
          >
            <div className="flex-1 min-w-0">
              <span className="font-medium text-foreground text-[13px]">
                Plan
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Collaborate on an approach before taking action
              </p>
            </div>
            {mode === "plan" && (
              <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            )}
          </button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function friendlyModelName(model: string): string {
  // Claude: claude-{tier}-{major}-{minor}[-dateYYYYMMDD] → Tier Major.Minor
  const claude = model.match(
    /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8,})?$/,
  );
  if (claude) {
    const tier = claude[1][0].toUpperCase() + claude[1].slice(1);
    return `${tier} ${claude[2]}.${claude[3]}`;
  }
  if (model.startsWith("gpt-")) return `GPT-${model.slice(4)}`;
  if (/^o\d/.test(model)) return model;
  // Gemini: gemini-{version-parts}[-preview] → Gemini Version Parts
  const gemini = model.match(/^gemini-(.+?)(?:-preview)?$/);
  if (gemini) {
    const parts = gemini[1]
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join(" ");
    return `Gemini ${parts}`;
  }
  return model;
}

/**
 * Deduplicate models to only the latest version per family.
 * e.g. [opus-4-7, opus-4-6, opus-4-5] → [opus-4-7]
 */
function latestModelsOnly(models: string[]): string[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    // Claude: family = tier (opus/sonnet/haiku)
    const claude = m.match(/^claude-(opus|sonnet|haiku)-/);
    if (claude) {
      if (seen.has(claude[1])) return false;
      seen.add(claude[1]);
      return true;
    }
    // GPT: family = gpt-{major} (e.g. gpt-5.4 and gpt-5.4-mini are different)
    // OpenAI reasoning: each is its own family
    // Gemini: family = gemini-{major} + variant
    const gemini = m.match(/^gemini-(\d+(?:\.\d+)?)-(.+?)(?:-preview)?$/);
    if (gemini) {
      const family = gemini[2]; // flash, pro, etc.
      if (seen.has(`gemini-${family}`)) return false;
      seen.add(`gemini-${family}`);
      return true;
    }
    return true;
  });
}

function ModelSelector({
  model,
  engines,
  onChange,
}: {
  model: string;
  engines: Array<{
    engine: string;
    label: string;
    models: string[];
    configured: boolean;
  }>;
  onChange: (model: string, engine: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          {friendlyModelName(model)}
          <IconChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={6}
          className="w-64 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg z-50 py-1 animate-in fade-in-0 zoom-in-95"
          style={{ fontSize: 13 }}
        >
          {engines.map((group) => {
            const models = latestModelsOnly(group.models);
            return (
              <div key={group.engine}>
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {group.label}
                  </span>
                  {!group.configured && (
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground/60 hover:text-foreground cursor-pointer"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("agent-panel:open-settings"),
                        );
                        setOpen(false);
                      }}
                    >
                      needs API key
                    </button>
                  )}
                </div>
                {models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      if (!group.configured) {
                        window.dispatchEvent(
                          new CustomEvent("agent-panel:open-settings"),
                        );
                        setOpen(false);
                        return;
                      }
                      onChange(m, group.engine);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-1.5 text-left ${
                      group.configured
                        ? "hover:bg-accent/50"
                        : "opacity-40 cursor-default"
                    }`}
                  >
                    <span className="flex-1 min-w-0 text-[13px] text-foreground truncate">
                      {friendlyModelName(m)}
                    </span>
                    {m === model && group.configured && (
                      <IconCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

type PopoverState = {
  type: "@" | "/";
  position: { top: number; left: number };
  startPos: number;
  query: string;
} | null;

export function TiptapComposer({
  placeholder = "Message agent...",
  disabled = false,
  focusRef,
  onSubmit,
  actionButton,
  extraActionButton,
  attachButton,
  onSlashCommand,
  execMode,
  onExecModeChange,
  voiceEnabled = true,
  selectedModel,
  availableModels,
  onModelChange,
}: TiptapComposerProps) {
  const [popover, setPopover] = useState<PopoverState>(null);
  const popoverRef = useRef<MentionPopoverRef>(null);
  const composerRuntime = useComposerRuntime();
  const [editorHasText, setEditorHasText] = useState(false);
  const composerText = useComposer((state) => state.text);
  const canSend = editorHasText && !disabled;
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);

  // Refs for values accessed in handleKeyDown (ProseMirror doesn't re-bind)
  const popoverStateRef = useRef<PopoverState>(null);
  const execModeRef = useRef(execMode);
  execModeRef.current = execMode;
  const onExecModeChangeRef = useRef(onExecModeChange);
  onExecModeChangeRef.current = onExecModeChange;

  const { items: mentionItems, isLoading: mentionsLoading } = useMentionSearch(
    popover?.type === "@" ? popover.query : "",
    popover?.type === "@",
  );

  const {
    skills,
    hint,
    isLoading: skillsLoading,
  } = useSkills(popover?.type === "/");

  const filteredCommands = useMemo(() => {
    if (!popover || popover.type !== "/") return BUILT_IN_COMMANDS;
    const q = popover.query.toLowerCase();
    if (!q) return BUILT_IN_COMMANDS;
    return BUILT_IN_COMMANDS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [popover]);

  const filteredSkills = useMemo(() => {
    if (!popover || popover.type !== "/") return skills;
    const q = popover.query.toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q),
    );
  }, [skills, popover]);

  // Keep refs in sync with state
  const mentionItemsRef = useRef(mentionItems);
  mentionItemsRef.current = mentionItems;
  const filteredCommandsRef = useRef(filteredCommands);
  filteredCommandsRef.current = filteredCommands;
  const filteredSkillsRef = useRef(filteredSkills);
  filteredSkillsRef.current = filteredSkills;
  const onSlashCommandRef = useRef(onSlashCommand);
  onSlashCommandRef.current = onSlashCommand;

  const closePopover = useCallback(() => {
    setPopover(null);
    popoverStateRef.current = null;
  }, []);

  // Persist draft to localStorage so hot-reloads don't lose the prompt
  const DRAFT_KEY = "an-composer-draft";
  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Tiptap reads extension config once at init; ref keeps runtime prop
  // changes visible to Placeholder's function form.
  const placeholderRef = useRef(placeholder);
  useEffect(() => {
    placeholderRef.current = placeholder;
  }, [placeholder]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        strike: false,
        italic: false,
        bold: false,
        code: false,
      }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
        emptyEditorClass: "is-editor-empty",
        showOnlyCurrent: false,
      }),
      FileReference,
      SkillReference,
      MentionReference,
    ],
    editable: !disabled,
    onCreate: ({ editor: ed }) => {
      // Restore draft on mount
      try {
        const saved = localStorage.getItem(DRAFT_KEY);
        if (saved) {
          ed.commands.setContent(saved);
          ed.commands.focus("end");
          setEditorHasText(ed.state.doc.textContent.trim().length > 0);
        }
      } catch {}
    },
    onUpdate: ({ editor: ed }) => {
      // Drive the send button's enabled state from the actual editor contents;
      // the composer runtime is only synced on submit, so its isEmpty lags.
      let hasContent = ed.state.doc.textContent.trim().length > 0;
      if (!hasContent) {
        ed.state.doc.descendants((node: any) => {
          if (
            node.type.name === "mentionReference" ||
            node.type.name === "fileReference" ||
            node.type.name === "skillReference"
          ) {
            hasContent = true;
            return false;
          }
          return true;
        });
      }
      setEditorHasText(hasContent);

      // Debounce-save draft to localStorage
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        try {
          const html = ed.getHTML();
          const isEmpty = !ed.state.doc.textContent.trim();
          if (isEmpty) {
            localStorage.removeItem(DRAFT_KEY);
          } else {
            localStorage.setItem(DRAFT_KEY, html);
          }
        } catch {}
      }, 300);
    },
    editorProps: {
      attributes: {
        class:
          "flex-1 resize-none bg-transparent text-sm text-foreground outline-none leading-[1.625rem] min-h-[3.25rem] max-h-[10rem] overflow-y-auto",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (files.length === 0) return false;

        event.preventDefault();
        void Promise.all(
          files.map((file) => composerRuntime.addAttachment(file)),
        ).catch((error) => {
          console.error("Error adding pasted attachment:", error);
        });
        return true;
      },
      handleKeyDown: (view, event) => {
        const pop = popoverStateRef.current;

        // Handle popover keyboard nav
        if (pop) {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            popoverRef.current?.moveUp();
            return true;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            popoverRef.current?.moveDown();
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const idx = popoverRef.current?.getSelectedIndex() ?? 0;
            const currentCommands = filteredCommandsRef.current;
            const currentSkills = filteredSkillsRef.current;
            if (pop.type === "@") {
              const item = popoverRef.current?.getSelectedMention();
              if (item) selectMention(view, pop, item);
            } else if (pop.type === "/") {
              const cmd = popoverRef.current?.getSelectedCommand();
              if (cmd) {
                executeCommand(view, pop, cmd);
              } else {
                const skillIdx = idx - currentCommands.length;
                if (currentSkills[skillIdx]) {
                  selectSkill(view, pop, currentSkills[skillIdx]);
                }
              }
            }
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            popoverStateRef.current = null;
            setPopover(null);
            return true;
          }
          if (event.key === " " && pop.query === "") {
            popoverStateRef.current = null;
            setPopover(null);
            return false;
          }
        }

        // Shift+Tab toggles build/plan mode
        if (event.key === "Tab" && event.shiftKey) {
          event.preventDefault();
          const current = execModeRef.current;
          const cb = onExecModeChangeRef.current;
          if (current && cb) {
            cb(current === "build" ? "plan" : "build");
          }
          return true;
        }

        // Submit on Enter (Shift+Enter for newline)
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey
        ) {
          event.preventDefault();
          submitComposer();
          return true;
        }

        // Detect @ trigger — only when preceded by start-of-text, space, or newline
        // (not after alphanumeric chars, which would indicate an email address)
        if (event.key === "@") {
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(
            Math.max(0, from - 1),
            from,
          );
          if (from === 1 || textBefore === "" || /\s/.test(textBefore)) {
            const coords = view.coordsAtPos(from);
            setTimeout(() => {
              const state: PopoverState = {
                type: "@",
                position: { top: coords.top, left: coords.left },
                startPos: view.state.selection.from,
                query: "",
              };
              popoverStateRef.current = state;
              setPopover(state);
            }, 0);
          }
          return false;
        }

        // Detect / trigger (only at start of line or after whitespace)
        if (event.key === "/") {
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(
            Math.max(0, from - 1),
            from,
          );
          if (from === 1 || textBefore === "" || /\s/.test(textBefore)) {
            const coords = view.coordsAtPos(from);
            setTimeout(() => {
              const state: PopoverState = {
                type: "/",
                position: { top: coords.top, left: coords.left },
                startPos: view.state.selection.from,
                query: "",
              };
              popoverStateRef.current = state;
              setPopover(state);
            }, 0);
          }
          return false;
        }

        return false;
      },
    },
  });

  useImperativeHandle(focusRef, () => ({
    focus() {
      editor?.commands.focus("end");
    },
  }));

  const insertTranscript = useCallback(
    (text: string) => {
      const ed = editor;
      if (!ed || !text) return;
      const { from } = ed.state.selection;
      const prevChar = from > 1 ? ed.state.doc.textBetween(from - 1, from) : "";
      const needsLead = prevChar && !/\s/.test(prevChar);
      ed.chain()
        .focus()
        .insertContent((needsLead ? " " : "") + text + " ")
        .run();
    },
    [editor],
  );

  const voice = useVoiceDictation({ onTranscript: insertTranscript });

  // Global shortcut: Cmd/Ctrl + Shift + M toggles dictation. Escape cancels
  // while recording. Scoped to avoid firing when focus is outside the app.
  useEffect(() => {
    if (!voiceEnabled || !voice.supported) return;
    const handler = (e: KeyboardEvent) => {
      const isToggleCombo =
        e.key.toLowerCase() === "m" &&
        e.shiftKey &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey;
      if (isToggleCombo) {
        e.preventDefault();
        if (voice.state === "recording" || voice.state === "starting") {
          voice.stop();
        } else if (voice.state !== "transcribing") {
          void voice.start();
        }
        return;
      }
      if (
        e.key === "Escape" &&
        (voice.state === "recording" || voice.state === "starting")
      ) {
        e.preventDefault();
        voice.cancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [voiceEnabled, voice]);

  const extractComposerPayload = useCallback(() => {
    const ed = editor;
    if (!ed) {
      return { text: "", references: [] as Reference[] };
    }

    const references: Reference[] = [];

    // Build text that preserves @mentions (getText() strips them).
    // Walk the document and reconstruct with @name for mention/file/skill nodes.
    const textParts: string[] = [];
    ed.state.doc.descendants((node: any) => {
      if (node.isText) {
        textParts.push(node.text);
      } else if (node.type.name === "mentionReference") {
        textParts.push(`@[${node.attrs.label}|${node.attrs.icon || "file"}]`);
      } else if (node.type.name === "fileReference") {
        const label = node.attrs.path?.split("/").pop() || node.attrs.path;
        textParts.push(`@[${label}|file]`);
      } else if (node.type.name === "skillReference") {
        textParts.push(`/${node.attrs.name}`);
      } else if (node.type.name === "hardBreak") {
        textParts.push("\n");
      } else if (
        node.type.name === "paragraph" &&
        textParts.length > 0 &&
        textParts[textParts.length - 1] !== "\n"
      ) {
        textParts.push("\n");
      }
    });
    const text = textParts.join("").trim();

    ed.state.doc.descendants((node: any) => {
      if (node.type.name === "fileReference") {
        // Legacy support
        references.push({
          type: "file",
          path: node.attrs.path,
          name: node.attrs.path?.split("/").pop() || node.attrs.path,
          source: node.attrs.source || "codebase",
        });
      } else if (node.type.name === "mentionReference") {
        const refType = node.attrs.refType;
        references.push({
          type:
            refType === "file"
              ? "file"
              : refType === "agent"
                ? "agent"
                : refType === "custom-agent"
                  ? "custom-agent"
                  : "mention",
          path: node.attrs.refPath || "",
          name: node.attrs.label,
          source: node.attrs.source,
          refType: node.attrs.refType,
          refId: node.attrs.refId,
        });
      } else if (node.type.name === "skillReference") {
        references.push({
          type: "skill",
          path: node.attrs.path,
          name: node.attrs.name,
          source: node.attrs.source || "codebase",
        });
      }
    });

    return { text, references };
  }, [editor]);

  const syncComposerState = useCallback(() => {
    const { text, references } = extractComposerPayload();
    composerRuntime.setText(text);
    composerRuntime.setRunConfig(
      references.length > 0 ? { custom: { references } } : {},
    );
    return { text, references };
  }, [composerRuntime, extractComposerPayload]);

  const submitComposer = useCallback(() => {
    const ed = editor;
    if (!ed) return;

    const { text, references } = syncComposerState();
    if (!text.trim() && references.length === 0) return;

    // Intercept slash commands typed directly (e.g. "/clear" + Enter)
    const trimmed = text.trim();
    if (trimmed.startsWith("/") && references.length === 0) {
      const cmdName = trimmed.slice(1).toLowerCase();
      const matched = BUILT_IN_COMMANDS.find((c) => c.name === cmdName);
      if (matched) {
        ed.commands.clearContent();
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {}
        closePopover();
        onSlashCommandRef.current?.(matched.name);
        return;
      }
    }

    if (onSubmit) {
      onSubmit(text, references);
    } else {
      composerRuntime.send();
    }
    ed.commands.clearContent();
    setEditorHasText(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    closePopover();
  }, [closePopover, composerRuntime, editor, onSubmit, syncComposerState]);

  // Helper functions that operate on the editor view directly
  // These are called from handleKeyDown which can't use React state
  function selectMention(
    view: any,
    pop: NonNullable<PopoverState>,
    item: MentionItem,
  ) {
    const ed = editor;
    if (!ed) return;
    const currentPos = ed.state.selection.from;
    // startPos is after the trigger char, so -1 to include the @ or /
    const deleteFrom = Math.max(0, pop.startPos - 1);
    ed.chain()
      .focus()
      .deleteRange({ from: deleteFrom, to: currentPos })
      .insertContent({
        type: "mentionReference",
        attrs: {
          label: item.label,
          icon: item.icon || "file",
          source: item.source,
          refType: item.refType,
          refId: item.refId || null,
          refPath: item.refPath || null,
        },
      })
      .insertContent(" ")
      .run();
    popoverStateRef.current = null;
    setPopover(null);
  }

  function executeCommand(
    view: any,
    pop: NonNullable<PopoverState>,
    command: SlashCommand,
  ) {
    const ed = editor;
    if (!ed) return;
    const currentPos = ed.state.selection.from;
    const deleteFrom = Math.max(0, pop.startPos - 1);
    ed.chain().focus().deleteRange({ from: deleteFrom, to: currentPos }).run();
    popoverStateRef.current = null;
    setPopover(null);
    onSlashCommandRef.current?.(command.name);
  }

  function selectSkill(
    view: any,
    pop: NonNullable<PopoverState>,
    skill: SkillResult,
  ) {
    const ed = editor;
    if (!ed) return;
    const currentPos = ed.state.selection.from;
    const deleteFrom = Math.max(0, pop.startPos - 1);
    ed.chain()
      .focus()
      .deleteRange({ from: deleteFrom, to: currentPos })
      .insertContent({
        type: "skillReference",
        attrs: { name: skill.name, path: skill.path, source: skill.source },
      })
      .insertContent(" ")
      .run();
    popoverStateRef.current = null;
    setPopover(null);
  }

  // Popover select handlers for click-based selection (from MentionPopover)
  const handleSelectMention = useCallback(
    (item: MentionItem) => {
      if (!editor || !popover) return;
      const currentPos = editor.state.selection.from;
      const deleteFrom = Math.max(0, popover.startPos - 1);
      editor
        .chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .insertContent({
          type: "mentionReference",
          attrs: {
            label: item.label,
            icon: item.icon || "file",
            source: item.source,
            refType: item.refType,
            refId: item.refId || null,
            refPath: item.refPath || null,
          },
        })
        .insertContent(" ")
        .run();
      closePopover();
    },
    [editor, popover, closePopover],
  );

  const handleSelectCommand = useCallback(
    (command: SlashCommand) => {
      if (!editor || !popover) return;
      const currentPos = editor.state.selection.from;
      const deleteFrom = Math.max(0, popover.startPos - 1);
      editor
        .chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .run();
      closePopover();
      onSlashCommand?.(command.name);
    },
    [editor, popover, closePopover, onSlashCommand],
  );

  const handleSelectSkill = useCallback(
    (skill: SkillResult) => {
      if (!editor || !popover) return;
      const currentPos = editor.state.selection.from;
      const deleteFrom = Math.max(0, popover.startPos - 1);
      editor
        .chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .insertContent({
          type: "skillReference",
          attrs: { name: skill.name, path: skill.path, source: skill.source },
        })
        .insertContent(" ")
        .run();
      closePopover();
    },
    [editor, popover, closePopover],
  );

  // Track query text as user types after trigger
  useEffect(() => {
    if (!editor || !popover) return;

    const updateHandler = () => {
      syncComposerState();

      const pop = popoverStateRef.current;
      if (!pop) return;
      const { from } = editor.state.selection;
      const { startPos, type } = pop;

      if (from < startPos) {
        closePopover();
        return;
      }

      const text = editor.state.doc.textBetween(startPos, from);

      // Verify the trigger character is still there
      if (startPos > 0) {
        const triggerChar = editor.state.doc.textBetween(
          startPos - 1,
          startPos,
        );
        if (
          (type === "@" && triggerChar !== "@") ||
          (type === "/" && triggerChar !== "/")
        ) {
          closePopover();
          return;
        }
      }

      const updated = { ...pop, query: text };
      popoverStateRef.current = updated;
      setPopover(updated);
    };

    editor.on("update", updateHandler);
    editor.on("selectionUpdate", updateHandler);
    return () => {
      editor.off("update", updateHandler);
      editor.off("selectionUpdate", updateHandler);
    };
  }, [editor, popover, closePopover, syncComposerState]);

  useEffect(() => {
    if (!editor) return;
    if (composerText !== "") return;
    if (editor.isEmpty) return;
    editor.commands.clearContent();
  }, [composerText, editor]);

  // Tiptap only reads `editable` at init; prop changes need setEditable.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
    if (disabled) editor.commands.blur();
  }, [editor, disabled]);

  return (
    <>
      <style>{`
        .aui-composer .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--color-muted-foreground);
          opacity: 0.5;
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
      <div className="px-2 pt-2 pb-1">
        <EditorContent
          editor={editor}
          className="aui-composer flex-1 min-w-0 [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0 px-0.5"
        />
      </div>
      {voiceEnabled && <VoiceRecordingOverlay voice={voice} />}
      <div className="flex items-center gap-1 px-2 py-1.5">
        {attachButton ?? <ComposerPlusMenu />}
        <div className="flex-1" />
        {actionButton ?? (
          <>
            {selectedModel && availableModels && onModelChange && (
              <ModelSelector
                model={selectedModel}
                engines={availableModels}
                onChange={onModelChange}
              />
            )}
            {execMode && onExecModeChange && (
              <ModeSelector mode={execMode} onChange={onExecModeChange} />
            )}
            {voiceEnabled && (
              <VoiceButton voice={voice} isMac={isMac} disabled={disabled} />
            )}
            {extraActionButton}
            <button
              type="button"
              onClick={submitComposer}
              disabled={!canSend}
              className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Send message"
            >
              <IconArrowUp className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      <MentionPopover
        ref={popoverRef}
        type={popover?.type ?? "@"}
        position={popover?.position ?? null}
        mentionItems={mentionItems}
        skills={filteredSkills}
        commands={filteredCommands}
        hint={hint}
        isLoading={popover?.type === "@" ? mentionsLoading : skillsLoading}
        query={popover?.query ?? ""}
        onSelectMention={handleSelectMention}
        onSelectSkill={handleSelectSkill}
        onSelectCommand={handleSelectCommand}
        onClose={closePopover}
      />
    </>
  );
}
