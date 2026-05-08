import type { Editor } from "@tiptap/react";
import {
  IconBold,
  IconItalic,
  IconStrikethrough,
  IconCode,
  IconLink,
  IconPencil,
  IconLoader2,
} from "@tabler/icons-react";
import { cn, formatShortcut } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createPortal } from "react-dom";

interface ComposeBubbleToolbarProps {
  editor: Editor;
  onFlush: () => Promise<unknown> | undefined;
  isGenerating: boolean;
  sendToAgent: (opts: {
    message: string;
    context?: string;
    submit?: boolean;
  }) => void;
}

const VIEWPORT_MARGIN = 8;
const TOOLBAR_GAP = 8;

/**
 * Custom bubble toolbar that avoids tiptap v3's BubbleMenu component.
 * The @tiptap/react/menus BubbleMenu has an internal useEditorState that
 * triggers infinite useSyncExternalStore re-render loops. This component
 * listens to editor events directly and positions itself via the DOM
 * selection API, avoiding the problematic subscription pattern. It renders in
 * a portal so selections on the first compose line are not clipped by the
 * scrollable compose body.
 */
export function ComposeBubbleToolbar({
  editor,
  onFlush,
  isGenerating,
  sendToAgent,
}: ComposeBubbleToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [activeMarks, setActiveMarks] = useState({
    bold: false,
    italic: false,
    strike: false,
    code: false,
    link: false,
  });
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);

  const updateToolbar = useCallback(() => {
    const toolbarHasFocus =
      toolbarRef.current?.contains(document.activeElement) ?? false;
    if (!editor.isFocused && !toolbarHasFocus) {
      setVisible(false);
      return;
    }
    const { from, to } = editor.state.selection;
    if (from === to) {
      setVisible(false);
      return;
    }
    const { selection } = editor.state;
    if ((selection as any).node) {
      setVisible(false);
      return;
    }

    let rect: {
      top: number;
      bottom: number;
      left: number;
      right: number;
      width: number;
      height: number;
    } | null = null;
    const domSelection = window.getSelection();
    if (editor.isFocused && domSelection && domSelection.rangeCount > 0) {
      const range = domSelection.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;
      const ancestorEl =
        ancestor.nodeType === Node.ELEMENT_NODE
          ? (ancestor as Element)
          : ancestor.parentElement;
      if (ancestorEl && editor.view.dom.contains(ancestorEl)) {
        const rangeRect = range.getBoundingClientRect();
        if (rangeRect.width !== 0 || rangeRect.height !== 0) {
          rect = rangeRect;
        }
      }
    }
    if (!rect) {
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const left = Math.min(start.left, end.left);
        const right = Math.max(start.right, end.right, start.left, end.left);
        const top = Math.min(start.top, end.top);
        const bottom = Math.max(start.bottom, end.bottom);
        rect = {
          top,
          bottom,
          left,
          right,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        };
      } catch {
        rect = null;
      }
    }
    if (!rect) return;
    if (rect.width === 0 && rect.height === 0) {
      setVisible(false);
      return;
    }

    const toolbarWidth = toolbarRef.current?.offsetWidth ?? 220;
    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 40;
    const centeredLeft = rect.left + rect.width / 2 - toolbarWidth / 2;
    const maxLeft = window.innerWidth - toolbarWidth - VIEWPORT_MARGIN;
    const topAbove = rect.top - toolbarHeight - TOOLBAR_GAP;
    const topBelow = rect.bottom + TOOLBAR_GAP;

    const top =
      topAbove >= VIEWPORT_MARGIN
        ? topAbove
        : Math.min(
            topBelow,
            window.innerHeight - toolbarHeight - VIEWPORT_MARGIN,
          );

    setPosition({
      top: Math.max(VIEWPORT_MARGIN, top),
      left: Math.max(VIEWPORT_MARGIN, Math.min(centeredLeft, maxLeft)),
    });

    setActiveMarks({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      link: editor.isActive("link"),
    });

    setVisible(true);
  }, [editor]);

  useEffect(() => {
    const handleBlur = () => {
      // Delay so focus can settle into link/AI inputs inside the toolbar
      setTimeout(() => {
        if (!toolbarRef.current?.contains(document.activeElement)) {
          setVisible(false);
        }
      }, 0);
    };
    editor.on("selectionUpdate", updateToolbar);
    editor.on("focus", updateToolbar);
    editor.on("blur", handleBlur);
    window.addEventListener("resize", updateToolbar);
    window.addEventListener("scroll", updateToolbar, true);
    return () => {
      editor.off("selectionUpdate", updateToolbar);
      editor.off("focus", updateToolbar);
      editor.off("blur", handleBlur);
      window.removeEventListener("resize", updateToolbar);
      window.removeEventListener("scroll", updateToolbar, true);
    };
  }, [editor, updateToolbar]);

  useEffect(() => {
    if (!visible) return;
    const id = window.requestAnimationFrame(updateToolbar);
    return () => window.cancelAnimationFrame(id);
  }, [isGenerating, showAiInput, showLinkInput, updateToolbar, visible]);

  const handleSetLink = () => {
    if (linkUrl.trim()) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl.trim() })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const toggleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const previousUrl = editor.getAttributes("link").href || "";
    setLinkUrl(previousUrl);
    setShowLinkInput(true);
    setShowAiInput(false);
  };

  const handleAiAssist = async () => {
    if (!aiPrompt.trim()) return;

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");

    await onFlush();

    sendToAgent({
      message: aiPrompt.trim(),
      context: `The user has selected specific text in their email draft and wants you to edit ONLY that selected portion. You MUST:\n1. Read the full draft from application-state/compose.json\n2. Find and replace ONLY the selected text (shown below) with your edited version based on the user's instruction\n3. Preserve ALL other content exactly as-is — subject, recipients, and every other part of the body that was not selected\n4. Write the updated draft back to application-state/compose.json\n\nSelected text to edit:\n"${selectedText}"`,
      submit: true,
    });

    setAiPrompt("");
    setShowAiInput(false);
  };

  if (!visible) return null;

  const items = [
    {
      icon: IconBold,
      title: "Bold",
      action: () => (editor.chain().focus() as any).toggleBold().run(),
      active: activeMarks.bold,
    },
    {
      icon: IconItalic,
      title: "Italic",
      action: () => (editor.chain().focus() as any).toggleItalic().run(),
      active: activeMarks.italic,
    },
    {
      icon: IconStrikethrough,
      title: "Strikethrough",
      action: () => (editor.chain().focus() as any).toggleStrike().run(),
      active: activeMarks.strike,
    },
    {
      icon: IconCode,
      title: "Code",
      action: () => (editor.chain().focus() as any).toggleCode().run(),
      active: activeMarks.code,
    },
    { type: "divider" as const },
    {
      icon: IconLink,
      title: "Link",
      action: toggleLink,
      active: activeMarks.link,
    },
  ];

  const toolbar = (
    <div
      ref={toolbarRef}
      className="bubble-toolbar"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 70,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {showLinkInput ? (
        <div className="flex items-center gap-1 px-1">
          <input
            autoFocus
            type="url"
            placeholder="Paste link..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSetLink();
              if (e.key === "Escape") {
                setShowLinkInput(false);
                setLinkUrl("");
              }
            }}
            className="bg-transparent border-none outline-none text-white text-sm w-48 px-1 py-0.5 placeholder:text-gray-400"
          />
          <button
            onClick={handleSetLink}
            className="text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 font-medium"
          >
            Apply
          </button>
        </div>
      ) : showAiInput || isGenerating ? (
        <div className="flex items-center gap-1 px-1">
          {isGenerating ? (
            <>
              <IconLoader2 size={14} className="animate-spin text-gray-400" />
              <span className="text-xs text-gray-400 px-1">Generating…</span>
            </>
          ) : (
            <>
              <textarea
                autoFocus
                placeholder="e.g. make more formal..."
                value={aiPrompt}
                rows={2}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleAiAssist();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setShowAiInput(false);
                    setAiPrompt("");
                  }
                }}
                className="bg-transparent border-none outline-none text-white text-sm w-52 px-1 py-0.5 placeholder:text-gray-400 resize-none leading-snug"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => void handleAiAssist()}
                    className="text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 font-medium shrink-0 self-end pb-1"
                  >
                    Generate
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Generate ({formatShortcut("cmd+enter")})
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          {items.map((item, i) => {
            if ("type" in item && item.type === "divider") {
              return (
                <div key={`d-${i}`} className="w-px h-5 bg-gray-600 mx-0.5" />
              );
            }
            const {
              icon: Icon,
              title,
              action,
              active,
            } = item as {
              icon: React.ElementType;
              title: string;
              action: () => void;
              active: boolean;
            };
            return (
              <Tooltip key={title}>
                <TooltipTrigger asChild>
                  <button
                    onClick={action}
                    className={cn(
                      "p-1.5 rounded transition-colors",
                      active
                        ? "bg-gray-600 text-white"
                        : "text-gray-300 hover:bg-gray-700 hover:text-white",
                    )}
                  >
                    <Icon size={14} strokeWidth={2.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{title}</TooltipContent>
              </Tooltip>
            );
          })}
          <div className="w-px h-5 bg-gray-600 mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowAiInput(true);
                  setShowLinkInput(false);
                }}
                className="p-1.5 rounded transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                <IconPencil size={14} strokeWidth={2.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent>AI Assist</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );

  return createPortal(toolbar, document.body);
}
