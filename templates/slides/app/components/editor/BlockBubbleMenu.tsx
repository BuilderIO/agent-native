import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconStrikethrough,
  IconLink,
  IconPalette,
  IconPencilStar,
  IconCheck,
  IconX,
  IconArrowUp,
  IconLoader2,
} from "@tabler/icons-react";
import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shortcutLabel } from "@/lib/utils";

interface BlockBubbleMenuProps {
  /** The element currently in contentEditable mode. Menu only shows while selection is inside it. */
  editingEl: HTMLElement | null;
  /** Slide the edited block belongs to, so an AI revision can target it. */
  slideId?: string;
  /** Deck that owns the slide — pins the revision to the right deck. */
  deckId?: string;
  /**
   * Ends the inline edit session and persists whatever is in the DOM now.
   * Required before handing work to the agent: otherwise the still-open
   * contentEditable serializes its stale text on the user's next click and
   * overwrites the revision the agent just wrote.
   */
  onCommitInlineEdit?: () => void;
}

interface Position {
  top: number;
  left: number;
}

/** Preset palette used by the color picker. */
const COLORS = [
  "#FFFFFF",
  "#E5E7EB",
  "#9CA3AF",
  "#000000",
  "#00E5FF",
  "#609FF8",
  "#A78BFA",
  "#F472B6",
  "#F59E0B",
  "#10B981",
  "#EF4444",
];

/** Shown above the input so the user can confirm what the agent will rewrite. */
const AI_TARGET_PREVIEW_LIMIT = 160;

const AI_SEND_BUTTON_CLASS =
  // guard:allow-raw-color — same accent as the link Apply button below.
  "rounded p-1.5 text-[#609FF8] hover:bg-accent disabled:pointer-events-none disabled:opacity-40";

export function buildReviseSelectionPrompt({
  selectedText,
  instruction,
  slideId,
  deckId,
}: {
  selectedText: string;
  instruction: string;
  slideId?: string;
  deckId?: string;
}): string {
  // The deck is named explicitly rather than left to "the current slide": the
  // request is queued, and if the user opens another deck before the agent
  // runs, an implicit target would pair this slide id with the wrong deck.
  const target = [
    deckId ? `Deck id: \`${deckId}\`` : null,
    slideId ? `Slide id: \`${slideId}\`` : null,
  ].filter((line) => line !== null);

  return [
    `Revise this exact text:`,
    ``,
    `"""`,
    selectedText,
    `"""`,
    ``,
    `How to revise it: ${instruction}`,
    ...(target.length > 0 ? [``, ...target] : []),
    ``,
    `Read that slide first with \`view-screen\`, then make one bounded \`update-slide --fullContent\` edit that replaces only the quoted text. Leave the surrounding HTML, inline styles, and layout untouched, and keep the replacement close to the original length so the slide still fits its canvas.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Floating formatting toolbar for contentEditable text blocks. Shows on
 * non-empty selection inside the editing element and applies inline
 * formatting (bold, italic, underline, strike, link, color) directly to
 * the DOM. Designed to work with the in-place per-block editing in
 * SlideEditor — it never mutates anything outside the editing element.
 *
 * The "Revise with AI" action is the exception: it does not touch the DOM.
 * It hands the selected text plus the user's instruction to the agent, which
 * rewrites the slide through `update-slide`.
 */
export function BlockBubbleMenu({
  editingEl,
  slideId,
  deckId,
  onCommitInlineEdit,
}: BlockBubbleMenuProps) {
  const t = useT();
  const [pos, setPos] = useState<Position | null>(null);
  const [showColors, setShowColors] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [showAiInput, setShowAiInput] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiTargetText, setAiTargetText] = useState("");
  const [aiSending, setAiSending] = useState(false);
  const savedRangeRef = useRef<Range | null>(null);
  // True while a popup/input has the user's focus — keeps the menu pinned
  // even when the contentEditable selection collapses behind the scenes.
  const interactingRef = useRef(false);
  useEffect(() => {
    interactingRef.current = showColors || showLinkInput || showAiInput;
  }, [showColors, showLinkInput, showAiInput]);

  // Hide menu when the editing element changes
  useEffect(() => {
    setPos(null);
    setShowColors(false);
    setShowLinkInput(false);
    setShowAiInput(false);
    setAiInstruction("");
  }, [editingEl]);

  // Track selection and position the menu
  useEffect(() => {
    if (!editingEl) return;

    const updatePosition = () => {
      if (interactingRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setPos(null);
        return;
      }
      const range = sel.getRangeAt(0);
      // Only show if selection is inside the editing element
      if (!editingEl.contains(range.commonAncestorContainer)) {
        setPos(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPos(null);
        return;
      }
      savedRangeRef.current = range.cloneRange();
      setPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    };

    document.addEventListener("selectionchange", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    updatePosition();

    return () => {
      document.removeEventListener("selectionchange", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [editingEl]);

  if (!editingEl || !pos) return null;

  /** Restore the saved selection before running a command (buttons steal focus). */
  const restoreSelection = () => {
    const range = savedRangeRef.current;
    if (!range) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    editingEl.focus();
    return true;
  };

  const runCommand = (cmd: string, value?: string) => {
    if (!restoreSelection()) return;
    // Force <span style="..."> output so colors survive sanitizeSlideHtml,
    // which strips <font> tags and would silently lose foreColor on save.
    document.execCommand("styleWithCSS", false, "true");
    // No state sync per-command — would re-run dangerouslySetInnerHTML and
    // wipe contentEditable. Final DOM is captured by exitInlineEdit.
    document.execCommand(cmd, false, value);
  };

  const applyColor = (color: string) => {
    runCommand("foreColor", color);
    setShowColors(false);
  };

  const applyLink = () => {
    if (!linkValue.trim()) return;
    const href = linkValue.startsWith("http")
      ? linkValue
      : `https://${linkValue}`;
    runCommand("createLink", href);
    setShowLinkInput(false);
    setLinkValue("");
  };

  const removeLink = () => {
    runCommand("unlink");
    setShowLinkInput(false);
    setLinkValue("");
  };

  const openAiInput = () => {
    if (showAiInput) {
      setShowAiInput(false);
      return;
    }
    // Snapshot the text now: opening the input moves focus out of the
    // contentEditable and the live selection collapses.
    const selected = savedRangeRef.current?.toString().trim() ?? "";
    if (!selected) return;
    setAiTargetText(selected);
    setAiInstruction("");
    interactingRef.current = true;
    setShowAiInput(true);
    setShowColors(false);
    setShowLinkInput(false);
  };

  const submitAiRevision = async () => {
    const instruction = aiInstruction.trim();
    if (!instruction || !aiTargetText || aiSending) return;

    // Close the inline edit first. The block is still a live contentEditable
    // session; leaving it open means the next click away serializes the old
    // text over whatever the agent writes.
    onCommitInlineEdit?.();

    setAiSending(true);
    try {
      const delivery = await sendToAgentChatAndConfirm({
        message: buildReviseSelectionPrompt({
          selectedText: aiTargetText,
          instruction,
          slideId,
          deckId,
        }),
        submit: true,
        chatTarget: "local",
      });

      if (!delivery.delivered) {
        // Keep the typed instruction so the user can retry without retyping.
        toast.error(t("raw.sendToAgent"), {
          description: delivery.reason ?? "The agent did not receive this.",
        });
        return;
      }

      toast.success(t("raw.sentToAgent"), { description: instruction });
      setShowAiInput(false);
      setAiInstruction("");
    } finally {
      setAiSending(false);
    }
  };

  return createPortal(
    <div
      data-block-bubble-menu="true"
      className="fixed z-[60] -translate-x-1/2 -translate-y-full flex items-center gap-0.5 p-1 rounded-lg bg-popover border border-border shadow-2xl shadow-black/60"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => {
        // Prevent blur on the editing element when clicking menu buttons
        e.preventDefault();
      }}
    >
      <ToolbarButton
        icon={IconPencilStar}
        tooltip="Revise with AI"
        onClick={openAiInput}
        active={showAiInput}
      />
      <div className="w-px h-4 bg-border mx-0.5" />
      <ToolbarButton
        icon={IconBold}
        tooltip={`Bold (${shortcutLabel("cmd+b")})`}
        onClick={() => runCommand("bold")}
      />
      <ToolbarButton
        icon={IconItalic}
        tooltip={`Italic (${shortcutLabel("cmd+i")})`}
        onClick={() => runCommand("italic")}
      />
      <ToolbarButton
        icon={IconUnderline}
        tooltip={`Underline (${shortcutLabel("cmd+u")})`}
        onClick={() => runCommand("underline")}
      />
      <ToolbarButton
        icon={IconStrikethrough}
        tooltip="Strikethrough"
        onClick={() => runCommand("strikeThrough")}
      />
      <div className="w-px h-4 bg-border mx-0.5" />
      <div className="relative">
        <ToolbarButton
          icon={IconPalette}
          tooltip="Color"
          onClick={() => {
            // Imperative set BEFORE state change — useEffect runs after the
            // input's autoFocus has already fired selectionchange, too late.
            if (!showColors) interactingRef.current = true;
            setShowColors((v) => !v);
            setShowLinkInput(false);
            setShowAiInput(false);
          }}
          active={showColors}
        />
        {showColors && (
          <div className="absolute top-full left-0 mt-1 p-3 rounded-lg bg-popover border border-border shadow-2xl shadow-black/60 grid grid-cols-6 gap-2 w-max">
            {COLORS.map((c) => (
              <Tooltip key={c}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyColor(c)}
                    className="w-7 h-7 rounded-md border border-foreground/25 hover:scale-110 transition-transform"
                    style={{ background: c }}
                    aria-label={`Set color ${c}`}
                  />
                </TooltipTrigger>
                <TooltipContent>{c}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
      <ToolbarButton
        icon={IconLink}
        tooltip="Link"
        onClick={() => {
          if (!showLinkInput) interactingRef.current = true;
          setShowLinkInput((v) => !v);
          setShowColors(false);
          setShowAiInput(false);
        }}
        active={showLinkInput}
      />
      {showAiInput && (
        <div
          data-ai-revise-input="true"
          // Own mousedown handler: the toolbar above blocks the default to keep
          // the contentEditable focused, which would also stop this input from
          // ever receiving a caret.
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-80 p-2 rounded-lg bg-popover border border-border shadow-2xl shadow-black/60"
        >
          <p className="mb-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {aiTargetText.length > AI_TARGET_PREVIEW_LIMIT
              ? `${aiTargetText.slice(0, AI_TARGET_PREVIEW_LIMIT)}…`
              : aiTargetText}
          </p>
          <div className="flex items-end gap-1">
            <textarea
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitAiRevision();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setShowAiInput(false);
                }
              }}
              placeholder={t("raw.tellAgentDo")}
              rows={2}
              disabled={aiSending}
              className="flex-1 resize-none rounded border border-border bg-muted px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring disabled:opacity-60"
              autoFocus
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void submitAiRevision()}
                  disabled={!aiInstruction.trim() || aiSending}
                  aria-label={t("raw.sendToAgent")}
                  className={AI_SEND_BUTTON_CLASS}
                >
                  {aiSending ? (
                    <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <IconArrowUp className="w-3.5 h-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("raw.sendToAgent")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
      {showLinkInput && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 flex items-center gap-1 p-1 rounded-lg bg-popover border border-border shadow-2xl shadow-black/60">
          <input
            type="text"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setShowLinkInput(false);
              }
            }}
            placeholder={t("raw.pasteUrl")}
            className="px-2 py-1 text-xs bg-muted rounded text-foreground outline-none border border-border focus:border-ring w-40"
            autoFocus
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={applyLink}
                className="p-1 rounded hover:bg-accent text-[#609FF8]"
              >
                <IconCheck className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Apply</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={removeLink}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
              >
                <IconX className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("raw.removeLink")}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>,
    document.body,
  );
}

function ToolbarButton({
  icon: Icon,
  tooltip,
  onClick,
  active,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  tooltip: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          aria-label={tooltip}
          className={`p-1.5 rounded transition-colors ${
            active
              ? "bg-[#609FF8]/20 text-[#609FF8]"
              : "text-foreground/80 hover:bg-accent hover:text-foreground"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
