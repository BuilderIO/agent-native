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
import { IconArrowUp, IconPaperclip } from "@tabler/icons-react";
import type { MentionItem, SkillResult, Reference } from "./types.js";

export interface TiptapComposerHandle {
  focus(): void;
}

interface TiptapComposerProps {
  placeholder?: string;
  disabled?: boolean;
  focusRef?: React.Ref<TiptapComposerHandle>;
  /** When provided, called instead of composerRuntime.send(). Used for queue mode. */
  onSubmit?: (text: string, references: Reference[]) => void;
  /** Custom action button (e.g. stop button) to render instead of the default send button. */
  actionButton?: React.ReactNode;
  /** Custom attachment button to render instead of ComposerPrimitive.AddAttachment. */
  attachButton?: React.ReactNode;
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
  attachButton,
}: TiptapComposerProps) {
  const [popover, setPopover] = useState<PopoverState>(null);
  const popoverRef = useRef<MentionPopoverRef>(null);
  const composerRuntime = useComposerRuntime();
  const canSend = useComposer((state) => !state.isEmpty);
  const composerText = useComposer((state) => state.text);
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);

  // Refs for values accessed in handleKeyDown (ProseMirror doesn't re-bind)
  const popoverStateRef = useRef<PopoverState>(null);

  const { items: mentionItems, isLoading: mentionsLoading } = useMentionSearch(
    popover?.type === "@" ? popover.query : "",
    popover?.type === "@",
  );

  const {
    skills,
    hint,
    isLoading: skillsLoading,
  } = useSkills(popover?.type === "/");

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
  const filteredSkillsRef = useRef(filteredSkills);
  filteredSkillsRef.current = filteredSkills;

  const closePopover = useCallback(() => {
    setPopover(null);
    popoverStateRef.current = null;
  }, []);

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
        placeholder,
        emptyEditorClass: "is-editor-empty",
        showOnlyCurrent: false,
      }),
      FileReference,
      SkillReference,
      MentionReference,
    ],
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "flex-1 resize-none bg-transparent text-sm text-foreground outline-none leading-[1.625rem] min-h-[1.625rem] max-h-[10rem] overflow-y-auto",
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
            const currentSkills = filteredSkillsRef.current;
            if (pop.type === "@") {
              const item = popoverRef.current?.getSelectedMention();
              if (item) selectMention(view, pop, item);
            } else if (pop.type === "/" && currentSkills[idx]) {
              selectSkill(view, pop, currentSkills[idx]);
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

    if (onSubmit) {
      onSubmit(text, references);
    } else {
      composerRuntime.send();
    }
    ed.commands.clearContent();
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

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1.5">
        {attachButton ?? (
          <ComposerPrimitive.AddAttachment asChild>
            <button
              type="button"
              className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Attach files"
            >
              <IconPaperclip className="h-4 w-4" />
            </button>
          </ComposerPrimitive.AddAttachment>
        )}
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
        <EditorContent
          editor={editor}
          className="aui-composer flex-1 min-w-0 [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0"
        />
        {actionButton ?? (
          <>
            {!canSend && (
              <kbd className="shrink-0 text-[11px] text-muted-foreground/40 font-medium border border-border/50 rounded px-1.5 py-0.5 leading-none pointer-events-none">
                {isMac ? "⌘I" : "Ctrl+I"}
              </kbd>
            )}
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
        hint={hint}
        isLoading={popover?.type === "@" ? mentionsLoading : skillsLoading}
        query={popover?.query ?? ""}
        onSelectMention={handleSelectMention}
        onSelectSkill={handleSelectSkill}
        onClose={closePopover}
      />
    </>
  );
}
