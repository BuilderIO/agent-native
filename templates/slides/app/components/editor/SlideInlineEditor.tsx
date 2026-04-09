import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { useEffect, useRef, useCallback } from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { Slide } from "@/context/DeckContext";
import { SlideBubbleMenu } from "./SlideBubbleMenu";
import {
  SlashCommandExtension,
  SlashMenuUI,
  useSlashMenu,
} from "./SlideSlashMenu";

interface SlideInlineEditorProps {
  slide: Slide;
  onContentChange: (html: string) => void;
  onExitEdit: () => void;
  /** Yjs document for collaborative editing. When provided, enables real-time collab. */
  ydoc?: Y.Doc | null;
  /** Yjs Awareness for cursor/presence sync. */
  awareness?: Awareness | null;
  /** Current user's display name and color for the cursor caret. */
  collabUser?: { name: string; color: string };
  /** True briefly when the AI agent is making edits. */
  agentActive?: boolean;
  /** Called when the user clicks the comment button with selected text. */
  onComment?: (quotedText: string) => void;
}

/** Resolve bg class / style from slide.background */
function resolveBackground(bg?: string): {
  bgClass: string;
  bgStyle?: React.CSSProperties;
} {
  if (!bg) return { bgClass: "bg-[#000000]" };
  if (bg.startsWith("bg-")) return { bgClass: bg };
  return { bgClass: "", bgStyle: { background: bg } };
}

/**
 * Strip fmd-slide wrapper and extract inner HTML for TipTap.
 * TipTap can parse the inner HTML and preserve text / basic structure.
 */
function extractEditableContent(content: string): string {
  if (!content) return "";

  // If it's fmd-slide HTML, extract inner content
  if (content.includes('class="fmd-slide"')) {
    // Parse with DOMParser to get the inner HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "text/html");
    const fmdSlide = doc.querySelector(".fmd-slide");
    if (fmdSlide) {
      // Convert divs with text to paragraphs so TipTap parses them correctly
      const result = convertDivsToBlocks(fmdSlide);
      return result;
    }
  }

  return content;
}

/** Recursively convert div structure to TipTap-friendly HTML */
function convertDivsToBlocks(el: Element): string {
  const children = Array.from(el.children);
  if (children.length === 0) {
    // Leaf text node — wrap in <p>
    const text = el.textContent?.trim();
    if (!text) return "";

    // Detect heading-like elements by font-size
    const style = (el as HTMLElement).style;
    const fontSize = parseFloat(style.fontSize || "0");
    if (fontSize >= 40) return `<h1>${text}</h1>`;
    if (fontSize >= 28) return `<h2>${text}</h2>`;
    if (fontSize >= 20) return `<h3>${text}</h3>`;
    return `<p>${text}</p>`;
  }

  // Container div — check if it looks like a list
  const isListContainer = children.every(
    (c) =>
      c.tagName === "DIV" &&
      (c as HTMLElement).style.display === "flex" &&
      c.textContent?.includes("●"),
  );

  if (isListContainer) {
    const items = children
      .map((c) => {
        // Strip the bullet span, keep the text span
        const spans = Array.from(c.querySelectorAll("span"));
        const textSpan = spans.find((s) => !s.textContent?.includes("●"));
        return textSpan ? `<li>${textSpan.textContent?.trim()}</li>` : "";
      })
      .filter(Boolean)
      .join("");
    return `<ul>${items}</ul>`;
  }

  // Recurse into children
  return children.map((c) => convertDivsToBlocks(c)).join("");
}

export function SlideInlineEditor({
  slide,
  onContentChange,
  onExitEdit,
  ydoc,
  awareness,
  collabUser,
  agentActive,
  onComment,
}: SlideInlineEditorProps) {
  const { bgClass, bgStyle } = resolveBackground(slide.background);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard flag: prevents the seeding setContent from triggering onContentChange
  const isSettingContent = useRef(false);

  const initialContent = extractEditableContent(slide.content);

  const editor = useEditor({
    extensions: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      StarterKit.configure(ydoc ? ({ history: false } as any) : {}),
      Placeholder.configure({
        placeholder: "Start typing… or press / for commands",
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-[#00E5FF] underline",
        },
      }),
      SlashCommandExtension,
      // Collaboration extensions — only active when ydoc is provided
      ...(ydoc
        ? [
            Collaboration.configure({ document: ydoc }),
            ...(awareness
              ? [
                  CollaborationCaret.configure({
                    provider: { awareness },
                    user: collabUser,
                  }),
                ]
              : []),
          ]
        : []),
    ],
    // When collab is active, content comes from Y.XmlFragment (seeded below).
    // When non-collab, use static initial content.
    content: ydoc ? undefined : initialContent || "<p></p>",
    autofocus: "end",
    onUpdate: ({ editor }) => {
      if (isSettingContent.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onContentChange(editor.getHTML());
      }, 300);
    },
  });

  // Seed the Y.XmlFragment from existing slide content on first open
  useEffect(() => {
    if (!editor || !ydoc || editor.isDestroyed) return;
    const fragment = ydoc.getXmlFragment("default");
    if (fragment.length === 0) {
      const html = extractEditableContent(slide.content);
      if (html) {
        isSettingContent.current = true;
        editor.commands.setContent(html, { emitUpdate: false });
        isSettingContent.current = false;
      }
    }
    // Only re-run when editor instance or ydoc changes, not on slide content updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, ydoc]);

  const { menuPosition, query, menuRef, closeMenu, executeCommand } =
    useSlashMenu(editor);

  // Flush any pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        if (editor && !editor.isDestroyed) {
          onContentChange(editor.getHTML());
        }
      }
    };
  }, [editor, onContentChange]);

  // Escape key → exit (but not when slash menu is open — let ProseMirror handle it)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (menuPosition !== null) {
          // Slash menu is open: let the event through so ProseMirror can
          // dispatch the slide-slash-nav event and close the menu.
          return;
        }
        e.stopPropagation();
        onExitEdit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onExitEdit, menuPosition]);

  return (
    <div
      className={`w-full aspect-video rounded-lg overflow-hidden relative shadow-2xl shadow-black/40 ring-2 ring-[#609FF8] ${bgClass}`}
      style={bgStyle}
    >
      {/* Scale the editor canvas to 960x540 just like SlideRenderer */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: 960,
          height: 540,
          transform: "scale(var(--slide-scale, 0.25))",
        }}
      >
        <SlideEditorCanvas editor={editor} slide={slide} />
      </div>
      {/* ScaleHelper mirrors SlideRenderer's ScaleHelper */}
      <ScaleHelper targetWidth={960} />

      {/* Bubble menu & slash menu live outside the scaled canvas so they render at screen scale */}
      {editor && <SlideBubbleMenu editor={editor} onComment={onComment} />}
      <SlashMenuUI
        ref={menuRef}
        editor={editor!}
        position={menuPosition}
        query={query}
        onClose={closeMenu}
        onCommand={executeCommand}
      />

      {/* AI editing indicator — shown briefly when agent makes edits */}
      {agentActive && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#a78bfa]/20 border border-[#a78bfa]/40 text-[#a78bfa] text-xs font-medium animate-pulse pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-[#a78bfa]" />
          AI editing
        </div>
      )}
    </div>
  );
}

/** The 960x540 TipTap editor canvas, styled like a slide */
function SlideEditorCanvas({
  editor,
  slide,
}: {
  editor: ReturnType<typeof useEditor>;
  slide: Slide;
}) {
  const layoutPadding: Record<string, string> = {
    title: "px-[110px] py-[80px]",
    content: "px-[110px] py-[80px]",
    "two-column": "px-[70px] py-[50px]",
    section: "px-[110px] py-[80px]",
    statement: "px-[110px] py-[60px]",
    image: "px-[80px] py-[60px]",
    "full-image": "p-0",
    blank: "p-8",
  };

  const padding = layoutPadding[slide.layout] ?? "px-[110px] py-[80px]";

  return (
    <div
      className={`w-[960px] h-[540px] relative flex flex-col justify-center ${padding}`}
      style={{ fontFamily: "'Poppins', sans-serif" }}
    >
      <EditorContent
        editor={editor}
        className="slide-tiptap-editor w-full h-full overflow-hidden focus:outline-none"
      />
    </div>
  );
}

/** Mirrors SlideRenderer's ScaleHelper */
function ScaleHelper({ targetWidth = 960 }: { targetWidth?: number }) {
  const cleanup = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const parent = el.parentElement;
      if (!parent) return;

      const updateScale = () => {
        const w = parent.offsetWidth;
        parent.style.setProperty("--slide-scale", String(w / targetWidth));
      };
      updateScale();

      const observer = new ResizeObserver(updateScale);
      observer.observe(parent);
      (el as unknown as { __cleanup: () => void }).__cleanup = () =>
        observer.disconnect();
    },
    [targetWidth],
  );

  return <div className="absolute inset-0 pointer-events-none" ref={cleanup} />;
}
