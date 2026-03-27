import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
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
import { MentionPopover, type MentionPopoverRef } from "./MentionPopover.js";
import { useFileSearch } from "./use-file-search.js";
import { useSkills } from "./use-skills.js";
import type { FileResult, SkillResult, Reference } from "./types.js";

interface TiptapComposerProps {
  onSubmit: (text: string, references: Reference[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

type PopoverState = {
  type: "@" | "/";
  position: { top: number; left: number };
  startPos: number;
  query: string;
} | null;

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 19V5" />
      <path d="M6 11L12 5L18 11" />
    </svg>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21.44 11.05L12.25 20.24C10.06 22.43 6.51 22.43 4.32 20.24C2.13 18.05 2.13 14.5 4.32 12.31L13.51 3.12C14.97 1.66 17.34 1.66 18.8 3.12C20.26 4.58 20.26 6.95 18.8 8.41L9.6 17.61C8.87 18.34 7.69 18.34 6.96 17.61C6.23 16.88 6.23 15.7 6.96 14.97L15.49 6.44" />
    </svg>
  );
}

export function TiptapComposer({
  onSubmit,
  placeholder = "Message agent...",
  disabled = false,
}: TiptapComposerProps) {
  const [popover, setPopover] = useState<PopoverState>(null);
  const popoverRef = useRef<MentionPopoverRef>(null);
  const composerRuntime = useComposerRuntime();
  const canSend = useComposer((state) => !state.isEmpty);
  const composerText = useComposer((state) => state.text);

  // Refs for values accessed in handleKeyDown (ProseMirror doesn't re-bind)
  const popoverStateRef = useRef<PopoverState>(null);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const { files, isLoading: filesLoading } = useFileSearch(
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
  const filesRef = useRef(files);
  filesRef.current = files;
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
    ],
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "flex-1 resize-none bg-transparent text-sm text-foreground outline-none leading-[1.625rem] min-h-[1.625rem] max-h-[10rem] overflow-y-auto",
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
            const currentFiles = filesRef.current;
            const currentSkills = filteredSkillsRef.current;
            if (pop.type === "@" && currentFiles[idx]) {
              selectFile(view, pop, currentFiles[idx]);
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

        // Detect @ trigger
        if (event.key === "@") {
          const coords = view.coordsAtPos(view.state.selection.from);
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

  const extractComposerPayload = useCallback(() => {
    const ed = editor;
    if (!ed) {
      return { text: "", references: [] as Reference[] };
    }

    const references: Reference[] = [];
    const text = ed.getText();

    ed.state.doc.descendants((node: any) => {
      if (node.type.name === "fileReference") {
        references.push({
          type: "file",
          path: node.attrs.path,
          name: node.attrs.path?.split("/").pop() || node.attrs.path,
          source: node.attrs.source || "codebase",
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

    onSubmitRef.current(text, references);
    composerRuntime.reset();
    ed.commands.clearContent();
    closePopover();
  }, [closePopover, composerRuntime, editor, syncComposerState]);

  // Helper functions that operate on the editor view directly
  // These are called from handleKeyDown which can't use React state
  function selectFile(
    view: any,
    pop: NonNullable<PopoverState>,
    file: FileResult,
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
        type: "fileReference",
        attrs: { path: file.path, source: file.source },
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
  const handleSelectFile = useCallback(
    (file: FileResult) => {
      if (!editor || !popover) return;
      const currentPos = editor.state.selection.from;
      const deleteFrom = Math.max(0, popover.startPos - 1);
      editor
        .chain()
        .focus()
        .deleteRange({ from: deleteFrom, to: currentPos })
        .insertContent({
          type: "fileReference",
          attrs: { path: file.path, source: file.source },
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
        <ComposerPrimitive.AddAttachment asChild>
          <button
            type="button"
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Attach files"
          >
            <PaperclipIcon className="h-4 w-4" />
          </button>
        </ComposerPrimitive.AddAttachment>
        <EditorContent
          editor={editor}
          className="flex-1 min-w-0 [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:m-0"
        />
        <button
          type="button"
          onClick={submitComposer}
          disabled={!canSend}
          className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Send message"
        >
          <SendIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <MentionPopover
        ref={popoverRef}
        type={popover?.type ?? "@"}
        position={popover?.position ?? null}
        files={files}
        skills={filteredSkills}
        hint={hint}
        isLoading={popover?.type === "@" ? filesLoading : skillsLoading}
        query={popover?.query ?? ""}
        onSelectFile={handleSelectFile}
        onSelectSkill={handleSelectSkill}
        onClose={closePopover}
      />
    </>
  );
}
