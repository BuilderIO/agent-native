import { isReconcileLeadClient, useT } from "@agent-native/core/client";
import { Extension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Color } from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useCallback, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

import type { Slide } from "@/context/DeckContext";

import { SlideBubbleMenu } from "./SlideBubbleMenu";
import {
  SlashCommandExtension,
  SlashMenuUI,
  useSlashMenu,
} from "./SlideSlashMenu";
import {
  copiedStyle,
  setCopiedStyle,
  type CopiedStyle,
} from "./style-clipboard";

interface SlideInlineEditorProps {
  slide: Slide;
  onContentChange: (html: string) => void;
  onExitEdit: () => void;
  /**
   * Deck `updatedAt` for the current slide content. Used to tell a genuinely
   * newer external edit (agent / peer-via-SQL) apart from a stale poll echo —
   * only newer content is reconciled into the live editor. Slides don't carry a
   * per-slide timestamp, so the deck-level one is the signal (it advances on
   * every update-slide / add-slide write).
   */
  contentUpdatedAt?: string | null;
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

/**
 * Decide whether an external slide-content change (an agent edit, or a peer's
 * edit mirrored to SQL) should be applied into the live editor. Mirrors the
 * documents template's `shouldApplyExternalContentSync` so the same "agent edit
 * reverts on next poll" whack-a-mole can't recur here.
 */
export function shouldApplySlideContentSync({
  nextContent,
  currentContent,
  contentUpdatedAt,
  lastAppliedUpdatedAt,
  isLeadClient,
  editorFocused,
  lastTypedAt,
  now,
}: {
  /** The incoming editable HTML (already extracted from slide.content). */
  nextContent: string;
  /** The editable HTML the editor currently reflects. */
  currentContent: string;
  /** Deck updatedAt for the incoming content. */
  contentUpdatedAt?: string | null;
  /** updatedAt of the content this editor currently reflects. */
  lastAppliedUpdatedAt?: string | null;
  /** Whether this client is the elected applier (see isReconcileLeadClient). */
  isLeadClient: boolean;
  editorFocused: boolean;
  lastTypedAt: number;
  now: number;
}): boolean {
  // Editor already shows the incoming content — e.g. a peer's edit arrived via
  // Yjs first, or this is our own state. Nothing to apply.
  if (currentContent === nextContent) return false;

  // Only adopt content that is genuinely NEWER than what this editor already
  // reflects. An older-or-equal `updatedAt` is a lagging poll / stale snapshot
  // and must never overwrite live edits. A fresh open has no baseline yet, so
  // it always adopts the loaded content.
  const externalNewer =
    !lastAppliedUpdatedAt ||
    (!!contentUpdatedAt && contentUpdatedAt > lastAppliedUpdatedAt);
  if (!externalNewer) return false;

  // Exactly one client (the lead) applies an authoritative snapshot into the
  // shared Y.Doc; every other client receives it through Yjs. Without this, N
  // clients would each diff the same snapshot into the CRDT and duplicate the
  // changed region.
  if (!isLeadClient) return false;

  // Don't yank text out from under someone typing this instant; the caller
  // retries shortly so the edit still lands once they pause.
  const typingRightNow = editorFocused && now - lastTypedAt < 1500;
  if (typingRightNow) return false;

  return true;
}

export function SlideInlineEditor({
  slide,
  onContentChange,
  onExitEdit,
  contentUpdatedAt,
  ydoc,
  awareness,
  collabUser,
  agentActive,
  onComment,
}: SlideInlineEditorProps) {
  const t = useT();
  const { bgClass, bgStyle } = resolveBackground(slide.background);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard flag: prevents the seeding setContent from triggering onContentChange
  const isSettingContent = useRef(false);
  // Tracks the last time the user actually typed, so an external edit can still
  // apply while the editor is focused-but-idle without yanking in-progress text.
  const lastTypedAtRef = useRef<number>(0);
  // updatedAt of the content this editor currently reflects. An older-or-equal
  // refetch is a stale snapshot (ignored); a newer one is an intentional
  // external edit (applied).
  const lastAppliedUpdatedAtRef = useRef<string | null>(
    contentUpdatedAt ?? null,
  );

  // Whether this client is the one that applies authoritative external snapshots
  // (agent edits, peer edits mirrored to SQL) into the shared Y.Doc. Exactly one
  // client does, so the changed region isn't inserted once per open editor.
  const [isLeadClient, setIsLeadClient] = useState(true);
  useEffect(() => {
    if (!awareness || !ydoc) {
      setIsLeadClient(true);
      return;
    }
    const update = () =>
      setIsLeadClient(isReconcileLeadClient(awareness, ydoc.clientID));
    update();
    awareness.on("change", update);
    return () => awareness.off("change", update);
  }, [awareness, ydoc]);

  const initialContent = extractEditableContent(
    typeof slide.content === "string" ? slide.content : "",
  );

  const StyleShortcuts = Extension.create({
    name: "styleShortcuts",
    addKeyboardShortcuts() {
      return {
        "Mod-Alt-c": ({ editor: e }) => {
          const attrs = e.getAttributes("textStyle");
          const style: CopiedStyle = {
            color: attrs.color as string | undefined,
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            strike: e.isActive("strike"),
          };
          setCopiedStyle(style);
          return true;
        },
        "Mod-Alt-v": ({ editor: e }) => {
          if (!copiedStyle) return false;
          const chain = e.chain().focus();
          if (copiedStyle.color) {
            chain.setColor(copiedStyle.color);
          } else {
            chain.unsetColor();
          }
          if (copiedStyle.bold) chain.setBold();
          else chain.unsetBold();
          if (copiedStyle.italic) chain.setItalic();
          else chain.unsetItalic();
          if (copiedStyle.strike) chain.setStrike();
          else chain.unsetStrike();
          chain.run();
          return true;
        },
      };
    },
  });

  const editor = useEditor({
    extensions: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      StarterKit.configure({
        link: false,
        ...(ydoc ? ({ history: false } as any) : {}),
      }),
      Placeholder.configure({
        placeholder: t("raw.startTypingCommands"),
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-[#00E5FF] underline",
        },
      }),
      TextStyle,
      Color,
      StyleShortcuts,
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
      lastTypedAtRef.current = Date.now();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        onContentChange(editor.getHTML());
      }, 300);
    },
  });

  // Seed the Y.XmlFragment from existing slide content on first open.
  // Only the lead client seeds an empty shared doc, so two clients opening a
  // brand-new slide at once don't both seed and duplicate the content.
  useEffect(() => {
    if (!editor || !ydoc || editor.isDestroyed) return;
    if (!isLeadClient) return;
    const fragment = ydoc.getXmlFragment("default");
    if (fragment.length === 0) {
      const html = extractEditableContent(
        typeof slide.content === "string" ? slide.content : "",
      );
      if (html) {
        isSettingContent.current = true;
        editor.commands.setContent(html, { emitUpdate: false });
        isSettingContent.current = false;
        if (contentUpdatedAt)
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
      }
    }
    // Only re-run when editor instance, ydoc, or lead-election changes, not on
    // every slide content update (the reconcile effect handles those).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, ydoc, isLeadClient]);

  // Reconcile authoritative external slide content (an agent edit, or a peer
  // edit mirrored to SQL) into the live editor. Driven by the deck `updatedAt`:
  // only content genuinely newer than what this editor already reflects is
  // applied, so a lagging poll can never revert live edits. The lead client
  // applies it through the editor's real content pipeline (so new block
  // structure renders) and the Yjs CRDT propagates the result to every other
  // client and persists it.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      if (cancelled || !editor || editor.isDestroyed) return;

      const nextContent = extractEditableContent(
        typeof slide.content === "string" ? slide.content : "",
      );
      const currentContent = editor.getHTML();

      // Already in sync: advance the applied watermark so a later write is
      // correctly recognized as newer, then stop.
      if (currentContent === nextContent) {
        if (contentUpdatedAt)
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
        return;
      }

      if (
        !shouldApplySlideContentSync({
          nextContent,
          currentContent,
          contentUpdatedAt,
          lastAppliedUpdatedAt: lastAppliedUpdatedAtRef.current,
          isLeadClient,
          editorFocused: editor.isFocused,
          lastTypedAt: lastTypedAtRef.current,
          now: Date.now(),
        })
      ) {
        // If we only deferred because the user is typing right now, re-check
        // shortly so the external edit still lands once they pause.
        const externalNewer =
          !lastAppliedUpdatedAtRef.current ||
          (!!contentUpdatedAt &&
            contentUpdatedAt > lastAppliedUpdatedAtRef.current);
        const typingRightNow =
          editor.isFocused && Date.now() - lastTypedAtRef.current < 1500;
        if (externalNewer && isLeadClient && typingRightNow) {
          retryTimer = setTimeout(run, 700);
        }
        return;
      }

      // Defer to a microtask so we don't trigger a synchronous React update
      // during render — setContent dispatches PM transactions that may update
      // React-owned state via the Collaboration extension.
      queueMicrotask(() => {
        if (cancelled || !editor || editor.isDestroyed) return;
        isSettingContent.current = true;
        // emitUpdate: false so the apply doesn't echo back through
        // onContentChange and overwrite SQL with our own re-serialization.
        editor.commands.setContent(nextContent, { emitUpdate: false });
        isSettingContent.current = false;
        if (contentUpdatedAt)
          lastAppliedUpdatedAtRef.current = contentUpdatedAt;
      });
    };

    run();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [editor, slide.content, contentUpdatedAt, isLeadClient]);

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
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#00B5FF]/20 border border-[#00B5FF]/40 text-[#00B5FF] text-xs font-medium animate-pulse pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-[#00B5FF]" />
          {t("raw.aiEditing")}
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
    title: "px-[110px] py-[80px]", // i18n-ignore Tailwind class list
    content: "px-[110px] py-[80px]", // i18n-ignore Tailwind class list
    "two-column": "px-[70px] py-[50px]",
    section: "px-[110px] py-[80px]", // i18n-ignore Tailwind class list
    statement: "px-[110px] py-[60px]", // i18n-ignore Tailwind class list
    image: "px-[80px] py-[60px]",
    "full-image": "p-0",
    blank: "p-8",
  };

  const padding = layoutPadding[slide.layout] ?? "px-[110px] py-[80px]"; // i18n-ignore Tailwind class list

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
        const w = parent.offsetWidth || parent.getBoundingClientRect().width;
        if (!w) return;
        parent.style.setProperty("--slide-scale", String(w / targetWidth));
      };
      updateScale();
      const raf = requestAnimationFrame(updateScale);

      const observer = new ResizeObserver(updateScale);
      observer.observe(parent);

      return () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
      };
    },
    [targetWidth],
  );

  return <div className="absolute inset-0 pointer-events-none" ref={cleanup} />;
}
